import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, lstat, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import bs58Module from "bs58";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import {
  loadDevnetRpcConfiguration,
  requireSecureDirectory,
  requireSecureRegularFile,
} from "./secure-rpc-env.mjs";

const bs58 = bs58Module.default ?? bs58Module;

const EXPECTED_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const FEE_PAYER = new PublicKey("G2f6Fv477ZyFbmRFtVr21jf9VufXpiRCxf1e91J6SxxT");
const BUFFER_AUTHORITY = new PublicKey("7wHuwk8DkqCN7vuEWzLhfLDQeiUUKKYfocjjDL5mxQvZ");
const CONTROLLER_PROGRAM = new PublicKey("CzyGUEVtLg2FTWdZmQ6KZCydw73KutLtE6c5PJgnxQqa");
const CONTROLLER_PROGRAMDATA = new PublicKey("H9zckD4ukjmKQL6tF5G9uZWixKomxeXxW2CPA3MkgPN9");
const BUFFER = new PublicKey("9DAowZpMbWKNAvjz81HXKQqUJbaTiQ9RZmgu5xgddogM");

const ARTIFACT_BYTES = 1_114_592;
const ARTIFACT_SHA256 = "0c107bce1ec34d3badf72b69161f0cae0b82a7b85ea714770f3876c08e6c1b18";
const BUFFER_HEADER_BYTES = 37;
const BUFFER_RAW_BYTES = BUFFER_HEADER_BYTES + ARTIFACT_BYTES;
const BUFFER_LAMPORTS = 7_758_764_400;
const INITIAL_BUFFER_RAW_SHA256 = "9fcfb538655b5f7a5224fae24bc730e20dcb69c69dd40bd5df4a03528f498cb0";
const INITIAL_BUFFER_PAYLOAD_SHA256 = "3d15e358e6aaa2372de167832698bcf90b6434aadec84ecd3c99d039da738ab8";

const WRITE_CHUNK_BYTES = 916;
const WRITE_BATCH_SIZE = 10;
const WRITE_SUBMISSION_PACING_MS = 1_000;
const MAX_PACKET_BYTES = 1_232;
const PLAN_VALIDITY_SLOTS = 100_000;
const ESTIMATED_MAX_FEE_PER_WRITE_LAMPORTS = 20_000;
const FEE_BALANCE_MARGIN_LAMPORTS = 50_000_000;
const INITIAL_RATE_LIMIT_BACKOFF_MS = 30_000;
const MAX_RATE_LIMIT_BACKOFF_MS = 10 * 60_000;

const INITIAL_EXACT_WRITE_COUNT = 32;
const INITIAL_EXACT_WRITTEN_BYTES = 29_312;
const INITIAL_HISTORY_SIGNATURE_COUNT = 33;
const INITIAL_WRITE_HISTORY_MANIFEST_SHA256 = "877887efc25d877c0c55c6012e49da5d02d6ff46a3509f2251fbb831973af254";
const INITIAL_PRESENT_OFFSETS = Object.freeze([
  916,
  2_748,
  3_664,
  4_580,
  5_496,
  6_412,
  7_328,
  14_656,
  15_572,
  18_320,
  23_816,
  24_732,
  25_648,
  27_480,
  30_228,
  32_976,
  36_640,
  41_220,
  486_396,
  496_472,
  497_388,
  501_968,
  895_848,
  900_428,
  906_840,
  907_756,
  910_504,
  912_336,
  946_228,
  950_808,
  953_556,
  955_388,
]);

const TOTAL_CHUNK_COUNT = Math.ceil(ARTIFACT_BYTES / WRITE_CHUNK_BYTES);
const FINAL_CHUNK_BYTES = ARTIFACT_BYTES % WRITE_CHUNK_BYTES;
const INITIAL_MISSING_CHUNK_COUNT = TOTAL_CHUNK_COUNT - INITIAL_EXACT_WRITE_COUNT;
const INITIAL_MISSING_BYTES = ARTIFACT_BYTES - INITIAL_EXACT_WRITTEN_BYTES;

const PLAN_SCHEMA = "ameba-governance-devnet-controller-buffer-upload-plan-v1";
const PLAN_FILE = "controller-buffer-upload-plan-v1.json";
const JOURNAL_FILE = "controller-buffer-upload-journal-v1.jsonl";
const LOCK_FILE = "controller-buffer-upload-v1.lock";
const ZERO_HASH = "0".repeat(64);

const PLAN_KEYS = [
  "artifactBytes",
  "artifactSha256",
  "baselineExactWriteCount",
  "baselineExactWrittenBytes",
  "baselineHistoryMaxSlot",
  "baselineHistoryMinSlot",
  "baselineHistorySignatureCount",
  "baselinePayloadSha256",
  "baselinePresentOffsets",
  "baselineRawSha256",
  "baselineWriteHistoryManifestSha256",
  "batchSize",
  "buffer",
  "bufferAuthority",
  "bufferLamports",
  "bufferRawBytes",
  "bufferRentMinimumLamports",
  "chunkCount",
  "chunkSize",
  "commitment",
  "controllerProgram",
  "controllerProgramdata",
  "estimatedMaximumFeeLamports",
  "feePayer",
  "feePayerBalanceLamports",
  "finalChunkBytes",
  "finalPayloadSha256",
  "finalRawSha256",
  "genesisHash",
  "loader",
  "mainnetAllowed",
  "missingBytes",
  "missingChunkCount",
  "observedSlot",
  "operationId",
  "planValidUntilSlot",
  "rpcProviderOriginSha256",
  "rpcSelection",
  "schema",
].sort();

class RateLimitExit extends Error {
  constructor(message, metadata = {}) {
    super(message);
    this.metadata = metadata;
  }
}
class RetryOnFreshInvocation extends Error {}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  assert(value, `missing required environment ${name}`);
  return value;
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function operationId(material) {
  return sha256Hex(Buffer.from(JSON.stringify(material), "utf8"));
}

function rpcProviderOriginSha256(origin) {
  return sha256Hex(Buffer.concat([
    Buffer.from("AMOEBA_DEVNET_RPC_PROVIDER_ORIGIN_V1", "ascii"),
    Buffer.from(origin, "utf8"),
  ]));
}

function assertExactKeys(value, keys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} keys changed`);
}

function isRateLimit(error) {
  return /(?:\b429\b|too many requests|rate.?limit)/iu.test(String(error?.message ?? error));
}

function providerRetryAfterMs(error) {
  const message = String(error?.message ?? error);
  const milliseconds = /(?:retry(?:ing)?(?:-|\s*)after|retry-after)[^0-9]{0,16}([0-9]+)\s*ms/iu.exec(message);
  if (milliseconds) return Number(milliseconds[1]);
  const seconds = /(?:retry(?:ing)?(?:-|\s*)after|retry-after)[^0-9]{0,16}([0-9]+)\s*(?:s|sec|seconds?)/iu.exec(message);
  if (seconds) return Number(seconds[1]) * 1_000;
  return null;
}

function exponentialBackoffMs(attempt) {
  assert(Number.isInteger(attempt) && attempt > 0, "rate-limit attempt is invalid");
  return Math.min(MAX_RATE_LIMIT_BACKOFF_MS, INITIAL_RATE_LIMIT_BACKOFF_MS * (2 ** (attempt - 1)));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function chunkForOffset(artifact, offset) {
  assert(Number.isInteger(offset) && offset >= 0 && offset < artifact.length, "chunk offset is invalid");
  assert.equal(offset % WRITE_CHUNK_BYTES, 0, "chunk offset is not canonical");
  return artifact.subarray(offset, Math.min(offset + WRITE_CHUNK_BYTES, artifact.length));
}

function buildLoaderWriteData(offset, bytes) {
  assert(bytes.length > 0 && bytes.length <= WRITE_CHUNK_BYTES, "Loader Write chunk length is invalid");
  const header = Buffer.alloc(16);
  header.writeUInt32LE(1, 0);
  header.writeUInt32LE(offset, 4);
  header.writeBigUInt64LE(BigInt(bytes.length), 8);
  return Buffer.concat([header, bytes]);
}

async function loadSecureKeypair(file, expected, label) {
  const secureFile = await requireSecureRegularFile(file, `${label} keypair`);
  const encoded = JSON.parse(await readFile(secureFile, "utf8"));
  assert(Array.isArray(encoded) && encoded.length === 64, `${label} keypair is malformed`);
  assert(encoded.every((value) => Number.isInteger(value) && value >= 0 && value <= 255), `${label} keypair bytes are malformed`);
  const signer = Keypair.fromSecretKey(Uint8Array.from(encoded));
  assert(signer.publicKey.equals(expected), `${label} identity changed`);
  return signer;
}

async function loadArtifact(runDir) {
  const artifactPath = path.resolve(requiredEnvironment("AMEBA_CONTROLLER_ARTIFACT"));
  const relative = path.relative(runDir, artifactPath);
  assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "controller artifact must be inside the secure ceremony run directory");
  const status = await lstat(artifactPath);
  assert(status.isFile() && !status.isSymbolicLink(), "controller artifact must be a regular non-symlink file");
  if (typeof process.getuid === "function") {
    assert.equal(status.uid, process.getuid(), "controller artifact owner changed");
  }
  const artifact = await readFile(artifactPath);
  assert.equal(artifact.length, ARTIFACT_BYTES, "controller artifact length changed");
  assert.equal(sha256Hex(artifact), ARTIFACT_SHA256, "controller artifact hash changed");
  for (let offset = 0; offset < artifact.length; offset += WRITE_CHUNK_BYTES) {
    assert(!chunkForOffset(artifact, offset).every((value) => value === 0), "artifact contains an ambiguous all-zero canonical chunk");
  }
  return artifact;
}

async function context() {
  const { rpcSelection, stateRpcOrigin, stateRpcUrl } = await loadDevnetRpcConfiguration();
  assert.equal(rpcSelection, "state", "controller buffer upload requires the default Devnet state RPC");
  const runDir = await requireSecureDirectory(requiredEnvironment("AMEBA_CEREMONY_RUN_DIR"), "ceremony run directory");
  const artifact = await loadArtifact(runDir);
  const toolSha256 = sha256Hex(await readFile(fileURLToPath(import.meta.url)));
  const payer = await loadSecureKeypair(requiredEnvironment("AMEBA_CEREMONY_FEE_PAYER"), FEE_PAYER, "fee payer");
  const initializer = await loadSecureKeypair(requiredEnvironment("AMEBA_CONTROLLER_INITIALIZER"), BUFFER_AUTHORITY, "controller initializer");
  const [derivedProgramdata] = PublicKey.findProgramAddressSync([CONTROLLER_PROGRAM.toBuffer()], LOADER);
  assert(derivedProgramdata.equals(CONTROLLER_PROGRAMDATA), "controller ProgramData derivation changed");
  const connection = new Connection(stateRpcUrl, {
    commitment: "finalized",
    confirmTransactionInitialTimeout: 60_000,
    disableRetryOnRateLimit: true,
  });
  return {
    artifact,
    connection,
    initializer,
    payer,
    rpcProviderOriginSha256: rpcProviderOriginSha256(stateRpcOrigin),
    rpcSelection,
    runDir,
    toolSha256,
  };
}

async function writeExclusiveJsonDurable(file, value) {
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(file, 0o600);
}

async function withExecutionLock(runDir, operationIdValue, callback) {
  const file = path.join(runDir, LOCK_FILE);
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify({ operationId: operationIdValue, pid: process.pid })}\n`, "utf8");
    await handle.sync();
    return await callback();
  } finally {
    await handle.close();
    await unlink(file);
  }
}

async function openJournal(runDir, operationIdValue) {
  const file = path.join(runDir, JOURNAL_FILE);
  let text = "";
  let handle;
  try {
    handle = await open(file, "wx+", 0o600);
    await handle.sync();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const secureFile = await requireSecureRegularFile(file, "controller buffer upload journal");
    const before = await lstat(secureFile);
    text = await readFile(secureFile, "utf8");
    handle = await open(secureFile, "a+");
    const after = await handle.stat();
    assert.equal(after.dev, before.dev, "controller buffer upload journal device changed");
    assert.equal(after.ino, before.ino, "controller buffer upload journal inode changed");
  }
  const status = await handle.stat();
  assert(status.isFile(), "controller buffer upload journal must be a regular file");
  if (typeof process.getuid === "function") {
    assert.equal(status.uid, process.getuid(), "controller buffer upload journal owner changed");
  }
  assert.equal(status.mode & 0o077, 0, "controller buffer upload journal permissions changed");
  assert(text.length === 0 || text.endsWith("\n"), "controller buffer upload journal has a partial tail");
  const entries = text.length === 0
    ? []
    : text.slice(0, -1).split("\n").map((line) => JSON.parse(line));
  let previousEntrySha256 = ZERO_HASH;
  for (const [index, entry] of entries.entries()) {
    assert(entry && typeof entry === "object" && !Array.isArray(entry), "controller buffer upload journal entry is malformed");
    assert.equal(entry.sequence, index + 1, "controller buffer upload journal sequence changed");
    assert.equal(entry.operationId, operationIdValue, "controller buffer upload journal operation changed");
    assert.equal(entry.previousEntrySha256, previousEntrySha256, "controller buffer upload journal chain changed");
    const { entrySha256, ...material } = entry;
    assert.equal(entrySha256, sha256Hex(Buffer.from(JSON.stringify(material), "utf8")), "controller buffer upload journal entry hash changed");
    previousEntrySha256 = entrySha256;
  }
  return {
    entries,
    file,
    async append(event, fields = {}) {
      const material = {
        sequence: entries.length + 1,
        timestamp: new Date().toISOString(),
        operationId: operationIdValue,
        previousEntrySha256,
        event,
        ...fields,
      };
      const entry = {
        ...material,
        entrySha256: sha256Hex(Buffer.from(JSON.stringify(material), "utf8")),
      };
      await handle.appendFile(`${JSON.stringify(entry)}\n`, "utf8");
      await handle.sync();
      entries.push(entry);
      previousEntrySha256 = entry.entrySha256;
      return entry;
    },
    async close() {
      await handle.close();
    },
  };
}

async function recordRateLimit(journal, stage, error, fields = {}) {
  const attempt = journal.entries.filter((entry) => entry.event === "rate-limited").length + 1;
  const providerDelayMs = providerRetryAfterMs(error);
  const backoffMs = Math.max(providerDelayMs ?? 0, exponentialBackoffMs(attempt));
  const nextAttemptNotBefore = new Date(Date.now() + backoffMs).toISOString();
  await journal.append("rate-limited", {
    stage,
    attempt,
    providerRetryAfterMs: providerDelayMs,
    appliedBackoffMs: backoffMs,
    nextAttemptNotBefore,
    ...fields,
    errorSha256: sha256Hex(Buffer.from(String(error?.message ?? error), "utf8")),
  });
  throw new RateLimitExit("Devnet RPC rate limit encountered", {
    attempt,
    backoffMs,
    nextAttemptNotBefore,
  });
}

async function enforceRecordedBackoff(journal) {
  const rateLimits = journal.entries.filter((entry) => entry.event === "rate-limited");
  if (rateLimits.length === 0) return;
  const last = rateLimits.at(-1);
  let nextAttemptNotBefore = last.nextAttemptNotBefore;
  let backoffMs = last.appliedBackoffMs;
  if (!nextAttemptNotBefore) {
    const existing = journal.entries.find(
      (entry) => entry.event === "backoff-derived" && entry.rateLimitSequence === last.sequence,
    );
    if (existing) {
      nextAttemptNotBefore = existing.nextAttemptNotBefore;
      backoffMs = existing.appliedBackoffMs;
    } else {
      backoffMs = exponentialBackoffMs(rateLimits.length);
      nextAttemptNotBefore = new Date(Date.parse(last.timestamp) + backoffMs).toISOString();
      await journal.append("backoff-derived", {
        rateLimitSequence: last.sequence,
        providerRetryAfterMs: null,
        appliedBackoffMs: backoffMs,
        nextAttemptNotBefore,
      });
    }
  }
  const remainingMs = Date.parse(nextAttemptNotBefore) - Date.now();
  if (remainingMs > 0) {
    throw new RateLimitExit("recorded Devnet RPC backoff is still active", {
      attempt: rateLimits.length,
      backoffMs,
      nextAttemptNotBefore,
    });
  }
}

async function executeRpc(journal, stage, callback) {
  try {
    return await callback();
  } catch (error) {
    if (!isRateLimit(error)) throw error;
    return recordRateLimit(journal, stage, error);
  }
}

async function fetchBufferSnapshot(connection, callRpc) {
  const response = await callRpc("buffer-state", () => connection.getMultipleAccountsInfoAndContext(
    [CONTROLLER_PROGRAM, CONTROLLER_PROGRAMDATA, BUFFER],
    { commitment: "finalized" },
  ));
  assert.equal(response.value[0], null, "controller Program address is occupied");
  assert.equal(response.value[1], null, "controller ProgramData address is occupied");
  const account = response.value[2];
  assert(account, "exact controller deploy buffer is absent");
  assert(account.owner.equals(LOADER), "controller deploy buffer owner changed");
  assert.equal(account.executable, false, "controller deploy buffer became executable");
  assert.equal(account.lamports, BUFFER_LAMPORTS, "controller deploy buffer lamports changed");
  const raw = Buffer.from(account.data);
  assert.equal(raw.length, BUFFER_RAW_BYTES, "controller deploy buffer length changed");
  assert.equal(raw.readUInt32LE(0), 1, "controller deploy buffer Loader tag changed");
  assert.equal(raw[4], 1, "controller deploy buffer authority option changed");
  assert(new PublicKey(raw.subarray(5, BUFFER_HEADER_BYTES)).equals(BUFFER_AUTHORITY), "controller deploy buffer authority changed");
  return {
    payload: raw.subarray(BUFFER_HEADER_BYTES),
    payloadSha256: sha256Hex(raw.subarray(BUFFER_HEADER_BYTES)),
    raw,
    rawSha256: sha256Hex(raw),
    slot: response.context.slot,
  };
}

function classifySnapshot(snapshot, artifact) {
  const exactOffsets = [];
  const zeroOffsets = [];
  for (let offset = 0; offset < artifact.length; offset += WRITE_CHUNK_BYTES) {
    const artifactChunk = chunkForOffset(artifact, offset);
    const currentChunk = snapshot.payload.subarray(offset, offset + artifactChunk.length);
    if (currentChunk.equals(artifactChunk)) {
      exactOffsets.push(offset);
    } else if (currentChunk.every((value) => value === 0)) {
      zeroOffsets.push(offset);
    } else {
      throw new Error(`controller deploy buffer chunk ${offset} is neither the exact artifact nor the reviewed zero baseline`);
    }
  }
  for (const offset of INITIAL_PRESENT_OFFSETS) {
    assert(exactOffsets.includes(offset), `reviewed initial chunk ${offset} changed`);
  }
  assert.equal(exactOffsets.length + zeroOffsets.length, TOTAL_CHUNK_COUNT, "controller deploy buffer chunk census changed");
  return { ...snapshot, exactOffsets, zeroOffsets };
}

function assertInitialSnapshot(state) {
  assert.equal(state.rawSha256, INITIAL_BUFFER_RAW_SHA256, "initial controller buffer raw hash changed");
  assert.equal(state.payloadSha256, INITIAL_BUFFER_PAYLOAD_SHA256, "initial controller buffer payload hash changed");
  assert.deepEqual(state.exactOffsets, [...INITIAL_PRESENT_OFFSETS], "initial exact chunk offsets changed");
  assert.equal(state.zeroOffsets.length, INITIAL_MISSING_CHUNK_COUNT, "initial missing chunk count changed");
}

function assertProgressExplained(state, replay, allowActive) {
  const baseline = new Set(INITIAL_PRESENT_OFFSETS);
  const finalized = replay.finalizedOffsets;
  const active = new Set(allowActive ? replay.activeAttempts.map((attempt) => attempt.offset) : []);
  for (const offset of state.exactOffsets) {
    assert(baseline.has(offset) || finalized.has(offset) || active.has(offset), `exact chunk ${offset} is not explained by the reviewed baseline or journal`);
  }
  for (const offset of finalized) {
    assert(state.exactOffsets.includes(offset), `journal-finalized chunk ${offset} is absent from finalized buffer state`);
  }
}

async function initialWriteHistoryEvidence(connection, artifact) {
  const signatures = await connection.getSignaturesForAddress(BUFFER, { limit: 1_000 }, "finalized");
  assert.equal(signatures.length, INITIAL_HISTORY_SIGNATURE_COUNT, "initial buffer signature history count changed");
  assert(signatures.every((entry) => entry.err === null && entry.confirmationStatus === "finalized"), "initial buffer history is not fully successful and finalized");
  const manifestSha256 = sha256Hex(Buffer.from(JSON.stringify(
    signatures.map((entry) => [entry.signature, entry.slot, entry.err]),
  ), "utf8"));
  assert.equal(manifestSha256, INITIAL_WRITE_HISTORY_MANIFEST_SHA256, "initial buffer history manifest changed");

  const writes = [];
  for (const signature of signatures) {
    const landed = await connection.getTransaction(signature.signature, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    });
    assert(landed?.meta && landed.meta.err === null, "initial buffer history transaction is absent or failed");
    const keys = landed.transaction.message.getAccountKeys().staticAccountKeys;
    for (const instruction of landed.transaction.message.compiledInstructions) {
      if (!keys[instruction.programIdIndex].equals(LOADER)) continue;
      const data = Buffer.from(instruction.data);
      if (data.length < 16 || data.readUInt32LE(0) !== 1) continue;
      const offset = data.readUInt32LE(4);
      const length = Number(data.readBigUInt64LE(8));
      const bytes = data.subarray(16);
      const accounts = Array.from(instruction.accountKeyIndexes, (index) => keys[index]);
      assert.equal(length, bytes.length, "initial Loader Write vector length changed");
      assert(offset + length <= artifact.length, "initial Loader Write range changed");
      assert(bytes.equals(artifact.subarray(offset, offset + length)), "initial Loader Write bytes differ from the exact artifact");
      assert(accounts[0]?.equals(BUFFER), "initial Loader Write buffer changed");
      assert(accounts[1]?.equals(BUFFER_AUTHORITY), "initial Loader Write authority changed");
      writes.push({ length, offset });
    }
  }
  writes.sort((left, right) => left.offset - right.offset);
  assert.equal(writes.length, INITIAL_EXACT_WRITE_COUNT, "initial exact Loader Write count changed");
  assert.equal(writes.reduce((sum, write) => sum + write.length, 0), INITIAL_EXACT_WRITTEN_BYTES, "initial exact Loader Write byte count changed");
  assert.deepEqual(writes.map((write) => write.offset), [...INITIAL_PRESENT_OFFSETS], "initial Loader Write offsets changed");
  assert(writes.every((write) => write.length === WRITE_CHUNK_BYTES), "initial Loader Write chunk length changed");
  return {
    historyMaxSlot: Math.max(...signatures.map((entry) => entry.slot)),
    historyMinSlot: Math.min(...signatures.map((entry) => entry.slot)),
    manifestSha256,
  };
}

function finalRawSha256(initialRaw, artifact) {
  return sha256Hex(Buffer.concat([initialRaw.subarray(0, BUFFER_HEADER_BYTES), artifact]));
}

async function planUpload() {
  const value = await context();
  assert.equal(await value.connection.getGenesisHash(), EXPECTED_GENESIS, "state RPC genesis changed");
  const snapshot = classifySnapshot(await fetchBufferSnapshot(
    value.connection,
    (_stage, callback) => callback(),
  ), value.artifact);
  assertInitialSnapshot(snapshot);
  const history = await initialWriteHistoryEvidence(value.connection, value.artifact);
  const [feePayerBalanceLamports, bufferRentMinimumLamports] = await Promise.all([
    value.connection.getBalance(FEE_PAYER, "finalized"),
    value.connection.getMinimumBalanceForRentExemption(BUFFER_RAW_BYTES, "finalized"),
  ]);
  assert(BUFFER_LAMPORTS >= bufferRentMinimumLamports, "controller deploy buffer is not rent exempt");
  const estimatedMaximumFeeLamports = INITIAL_MISSING_CHUNK_COUNT * ESTIMATED_MAX_FEE_PER_WRITE_LAMPORTS;
  assert(feePayerBalanceLamports >= estimatedMaximumFeeLamports + FEE_BALANCE_MARGIN_LAMPORTS, "fee payer cannot cover bounded write fees plus margin");
  const material = {
    schema: PLAN_SCHEMA,
    genesisHash: EXPECTED_GENESIS,
    commitment: "finalized",
    rpcSelection: value.rpcSelection,
    rpcProviderOriginSha256: value.rpcProviderOriginSha256,
    observedSlot: snapshot.slot,
    planValidUntilSlot: snapshot.slot + PLAN_VALIDITY_SLOTS,
    controllerProgram: CONTROLLER_PROGRAM.toBase58(),
    controllerProgramdata: CONTROLLER_PROGRAMDATA.toBase58(),
    buffer: BUFFER.toBase58(),
    loader: LOADER.toBase58(),
    feePayer: FEE_PAYER.toBase58(),
    bufferAuthority: BUFFER_AUTHORITY.toBase58(),
    artifactBytes: ARTIFACT_BYTES,
    artifactSha256: ARTIFACT_SHA256,
    bufferRawBytes: BUFFER_RAW_BYTES,
    bufferLamports: BUFFER_LAMPORTS,
    bufferRentMinimumLamports,
    baselineRawSha256: INITIAL_BUFFER_RAW_SHA256,
    baselinePayloadSha256: INITIAL_BUFFER_PAYLOAD_SHA256,
    baselineHistorySignatureCount: INITIAL_HISTORY_SIGNATURE_COUNT,
    baselineExactWriteCount: INITIAL_EXACT_WRITE_COUNT,
    baselineExactWrittenBytes: INITIAL_EXACT_WRITTEN_BYTES,
    baselineWriteHistoryManifestSha256: history.manifestSha256,
    baselineHistoryMinSlot: history.historyMinSlot,
    baselineHistoryMaxSlot: history.historyMaxSlot,
    chunkSize: WRITE_CHUNK_BYTES,
    chunkCount: TOTAL_CHUNK_COUNT,
    finalChunkBytes: FINAL_CHUNK_BYTES,
    baselinePresentOffsets: [...INITIAL_PRESENT_OFFSETS],
    missingChunkCount: INITIAL_MISSING_CHUNK_COUNT,
    missingBytes: INITIAL_MISSING_BYTES,
    batchSize: WRITE_BATCH_SIZE,
    finalRawSha256: finalRawSha256(snapshot.raw, value.artifact),
    finalPayloadSha256: ARTIFACT_SHA256,
    feePayerBalanceLamports,
    estimatedMaximumFeeLamports,
    mainnetAllowed: false,
  };
  const plan = { ...material, operationId: operationId(material) };
  await writeExclusiveJsonDurable(path.join(value.runDir, PLAN_FILE), plan);
  console.log(JSON.stringify({
    operationId: plan.operationId,
    exactChunksAlreadyPresent: INITIAL_EXACT_WRITE_COUNT,
    missingChunks: INITIAL_MISSING_CHUNK_COUNT,
    batchSize: WRITE_BATCH_SIZE,
  }));
}

async function readPlan(value) {
  const file = await requireSecureRegularFile(path.join(value.runDir, PLAN_FILE), "controller buffer upload plan");
  const raw = await readFile(file);
  const plan = JSON.parse(raw.toString("utf8"));
  assertExactKeys(plan, PLAN_KEYS, "controller buffer upload plan");
  const { operationId: storedOperationId, ...material } = plan;
  assert.equal(operationId(material), storedOperationId, "controller buffer upload operation ID changed");
  assert.equal(plan.schema, PLAN_SCHEMA);
  assert.equal(plan.genesisHash, EXPECTED_GENESIS);
  assert.equal(plan.commitment, "finalized");
  assert.equal(plan.rpcSelection, "state");
  assert.equal(plan.rpcSelection, value.rpcSelection);
  assert.equal(plan.rpcProviderOriginSha256, value.rpcProviderOriginSha256);
  assert.equal(plan.controllerProgram, CONTROLLER_PROGRAM.toBase58());
  assert.equal(plan.controllerProgramdata, CONTROLLER_PROGRAMDATA.toBase58());
  assert.equal(plan.buffer, BUFFER.toBase58());
  assert.equal(plan.loader, LOADER.toBase58());
  assert.equal(plan.feePayer, FEE_PAYER.toBase58());
  assert.equal(plan.bufferAuthority, BUFFER_AUTHORITY.toBase58());
  assert.equal(plan.artifactBytes, ARTIFACT_BYTES);
  assert.equal(plan.artifactSha256, ARTIFACT_SHA256);
  assert.equal(plan.bufferRawBytes, BUFFER_RAW_BYTES);
  assert.equal(plan.bufferLamports, BUFFER_LAMPORTS);
  assert.equal(plan.baselineRawSha256, INITIAL_BUFFER_RAW_SHA256);
  assert.equal(plan.baselinePayloadSha256, INITIAL_BUFFER_PAYLOAD_SHA256);
  assert.equal(plan.baselineHistorySignatureCount, INITIAL_HISTORY_SIGNATURE_COUNT);
  assert.equal(plan.baselineExactWriteCount, INITIAL_EXACT_WRITE_COUNT);
  assert.equal(plan.baselineExactWrittenBytes, INITIAL_EXACT_WRITTEN_BYTES);
  assert.equal(plan.baselineWriteHistoryManifestSha256, INITIAL_WRITE_HISTORY_MANIFEST_SHA256);
  assert.equal(plan.chunkSize, WRITE_CHUNK_BYTES);
  assert.equal(plan.chunkCount, TOTAL_CHUNK_COUNT);
  assert.equal(plan.finalChunkBytes, FINAL_CHUNK_BYTES);
  assert.deepEqual(plan.baselinePresentOffsets, [...INITIAL_PRESENT_OFFSETS]);
  assert.equal(plan.missingChunkCount, INITIAL_MISSING_CHUNK_COUNT);
  assert.equal(plan.missingBytes, INITIAL_MISSING_BYTES);
  assert.equal(plan.batchSize, WRITE_BATCH_SIZE);
  assert.equal(plan.finalPayloadSha256, ARTIFACT_SHA256);
  assert.equal(plan.mainnetAllowed, false);
  assert(Number.isInteger(plan.observedSlot) && Number.isInteger(plan.planValidUntilSlot));
  assert.equal(plan.planValidUntilSlot, plan.observedSlot + PLAN_VALIDITY_SLOTS);
  assert(Number.isInteger(plan.bufferRentMinimumLamports) && plan.bufferRentMinimumLamports > 0);
  assert(Number.isInteger(plan.feePayerBalanceLamports) && plan.feePayerBalanceLamports > 0);
  assert.equal(plan.estimatedMaximumFeeLamports, INITIAL_MISSING_CHUNK_COUNT * ESTIMATED_MAX_FEE_PER_WRITE_LAMPORTS);
  return { plan, planSha256: sha256Hex(raw) };
}

function validatePreparedEntry(entry, artifact) {
  assert(Number.isInteger(entry.batch) && entry.batch > 0, "prepared batch is invalid");
  assert(Number.isInteger(entry.attempt) && entry.attempt > 0, "prepared attempt is invalid");
  assert(Number.isInteger(entry.offset) && entry.offset >= 0 && entry.offset % WRITE_CHUNK_BYTES === 0, "prepared offset is invalid");
  assert.equal(entry.chunkIndex, entry.offset / WRITE_CHUNK_BYTES, "prepared chunk index changed");
  const chunk = chunkForOffset(artifact, entry.offset);
  assert.equal(entry.length, chunk.length, "prepared chunk length changed");
  assert.equal(entry.chunkSha256, sha256Hex(chunk), "prepared chunk hash changed");
  assert(typeof entry.wireBase64 === "string" && entry.wireBase64.length > 0, "prepared wire bytes are absent");
  const raw = Buffer.from(entry.wireBase64, "base64");
  assert.equal(raw.toString("base64"), entry.wireBase64, "prepared wire encoding changed");
  assert.equal(raw.length, entry.wireBytes, "prepared wire length changed");
  assert(raw.length <= MAX_PACKET_BYTES, "prepared transaction exceeds the packet limit");
  assert.equal(sha256Hex(raw), entry.wireSha256, "prepared wire hash changed");
  const transaction = Transaction.from(raw);
  assert(transaction.feePayer?.equals(FEE_PAYER), "prepared fee payer changed");
  assert.equal(transaction.recentBlockhash, entry.blockhash, "prepared blockhash changed");
  assert.equal(transaction.signatures.length, 2, "prepared signer count changed");
  assert(transaction.signatures[0].publicKey.equals(FEE_PAYER), "prepared fee-payer signer changed");
  assert(transaction.signatures[1].publicKey.equals(BUFFER_AUTHORITY), "prepared buffer-authority signer changed");
  assert(transaction.signatures.every((signature) => signature.signature && signature.signature.some((byte) => byte !== 0)), "prepared signature is absent");
  assert(transaction.signature, "prepared transaction signature is absent");
  assert.equal(bs58.encode(transaction.signature), entry.signature, "prepared signature changed");
  assert.equal(sha256Hex(transaction.serializeMessage()), entry.messageSha256, "prepared message hash changed");
  assert.equal(transaction.instructions.length, 1, "prepared transaction must contain one instruction");
  const instruction = transaction.instructions[0];
  assert(instruction.programId.equals(LOADER), "prepared instruction program changed");
  assert.equal(instruction.keys.length, 2, "prepared Loader Write account count changed");
  assert(instruction.keys[0].pubkey.equals(BUFFER) && !instruction.keys[0].isSigner && instruction.keys[0].isWritable, "prepared Loader Write buffer privilege changed");
  assert(instruction.keys[1].pubkey.equals(BUFFER_AUTHORITY) && instruction.keys[1].isSigner && !instruction.keys[1].isWritable, "prepared Loader Write authority privilege changed");
  assert(Buffer.from(instruction.data).equals(buildLoaderWriteData(entry.offset, chunk)), "prepared Loader Write data changed");
  assert(Number.isInteger(entry.lastValidBlockHeight) && entry.lastValidBlockHeight > 0, "prepared last-valid block height is invalid");
  return { entry, raw, transaction };
}

function replayJournal(entries, artifact) {
  const attemptsByOffset = new Map();
  const attemptsBySignature = new Map();
  let maxBatch = 0;
  for (const entry of entries) {
    if (entry.event === "prepared") {
      const prepared = validatePreparedEntry(entry, artifact);
      assert(!attemptsBySignature.has(entry.signature), "prepared signature is duplicated");
      const attempts = attemptsByOffset.get(entry.offset) ?? [];
      assert.equal(entry.attempt, attempts.length + 1, "prepared attempt sequence changed");
      if (attempts.length > 0) {
        const previous = attempts.at(-1);
        assert(previous.expired && !previous.finalized && !previous.failed, "new attempt was prepared before the prior attempt expired unaccepted");
      }
      const attempt = {
        ...prepared,
        attempt: entry.attempt,
        batch: entry.batch,
        expired: false,
        failed: false,
        finalized: false,
        offset: entry.offset,
      };
      attempts.push(attempt);
      attemptsByOffset.set(entry.offset, attempts);
      attemptsBySignature.set(entry.signature, attempt);
      maxBatch = Math.max(maxBatch, entry.batch);
      continue;
    }
    if (["send-prepared", "submitted", "resubmit-prepared", "resubmitted", "submission-unknown", "transaction-failed", "finalized", "expired-unaccepted"].includes(entry.event)) {
      const attempt = attemptsBySignature.get(entry.signature);
      assert(attempt, `${entry.event} refers to an unknown prepared signature`);
      assert.equal(entry.offset, attempt.offset, `${entry.event} offset changed`);
      if (entry.event === "send-prepared" || entry.event === "resubmit-prepared") {
        assert.equal(entry.messageSha256, attempt.entry.messageSha256, "resubmission message hash changed");
        assert.equal(entry.wireSha256, attempt.entry.wireSha256, "resubmission wire hash changed");
        assert.equal(entry.wireBytes, attempt.entry.wireBytes, "resubmission wire length changed");
        assert(Number.isInteger(entry.minContextSlot) && entry.minContextSlot > 0, "submission minimum context slot is invalid");
      }
      if (entry.event === "transaction-failed") attempt.failed = true;
      if (entry.event === "expired-unaccepted") attempt.expired = true;
      if (entry.event === "finalized") {
        assert.equal(entry.messageSha256, attempt.entry.messageSha256, "finalized message hash changed");
        assert(Number.isInteger(entry.slot) && entry.slot > 0, "finalized slot is invalid");
        attempt.finalized = true;
      }
    }
  }
  for (const attempts of attemptsByOffset.values()) {
    for (const attempt of attempts) {
      assert(!(attempt.finalized && attempt.expired), "attempt is both finalized and expired");
      assert(!attempt.failed, `prepared transaction ${attempt.entry.signature} finalized with an error`);
    }
    const finalizedAttempts = attempts.filter((attempt) => attempt.finalized);
    assert(finalizedAttempts.length <= 1, "more than one attempt finalized for a chunk");
    assert(!(finalizedAttempts.length === 1 && attempts.at(-1) !== finalizedAttempts[0]), "a later attempt exists after chunk finalization");
  }
  const finalizedOffsets = new Set(
    [...attemptsByOffset.entries()]
      .filter(([, attempts]) => attempts.some((attempt) => attempt.finalized))
      .map(([offset]) => offset),
  );
  const activeAttempts = [...attemptsByOffset.values()]
    .map((attempts) => attempts.at(-1))
    .filter((attempt) => !attempt.finalized && !attempt.expired && !attempt.failed);
  return { activeAttempts, attemptsByOffset, finalizedOffsets, maxBatch };
}

function preparedTransaction(artifact, offset, latest, payer, initializer) {
  const chunk = chunkForOffset(artifact, offset);
  const instruction = new TransactionInstruction({
    programId: LOADER,
    keys: [
      { pubkey: BUFFER, isSigner: false, isWritable: true },
      { pubkey: BUFFER_AUTHORITY, isSigner: true, isWritable: false },
    ],
    data: buildLoaderWriteData(offset, chunk),
  });
  const transaction = new Transaction({
    feePayer: FEE_PAYER,
    recentBlockhash: latest.blockhash,
  }).add(instruction);
  transaction.sign(payer, initializer);
  const raw = Buffer.from(transaction.serialize());
  assert(raw.length <= MAX_PACKET_BYTES, `Loader Write packet at ${offset} exceeds ${MAX_PACKET_BYTES} bytes`);
  assert(transaction.signature, "prepared fee-payer signature is absent");
  return {
    blockhash: latest.blockhash,
    chunk,
    lastValidBlockHeight: latest.lastValidBlockHeight,
    messageSha256: sha256Hex(transaction.serializeMessage()),
    raw,
    signature: bs58.encode(transaction.signature),
    transaction,
    wireSha256: sha256Hex(raw),
  };
}

async function appendPrepared(journal, artifact, offset, latest, payer, initializer, batch, attempt) {
  const prepared = preparedTransaction(artifact, offset, latest, payer, initializer);
  const entry = await journal.append("prepared", {
    batch,
    attempt,
    chunkIndex: offset / WRITE_CHUNK_BYTES,
    offset,
    length: prepared.chunk.length,
    chunkSha256: sha256Hex(prepared.chunk),
    signature: prepared.signature,
    blockhash: prepared.blockhash,
    lastValidBlockHeight: prepared.lastValidBlockHeight,
    messageSha256: prepared.messageSha256,
    wireSha256: prepared.wireSha256,
    wireBytes: prepared.raw.length,
    wireBase64: prepared.raw.toString("base64"),
  });
  return validatePreparedEntry(entry, artifact);
}

async function submitPrepared(connection, journal, attempt, resubmission, minContextSlot) {
  assert(Number.isInteger(minContextSlot) && minContextSlot > 0, "submission minimum context slot is invalid");
  await journal.append(resubmission ? "resubmit-prepared" : "send-prepared", {
    signature: attempt.entry.signature,
    offset: attempt.offset,
    messageSha256: attempt.entry.messageSha256,
    wireSha256: attempt.entry.wireSha256,
    wireBytes: attempt.entry.wireBytes,
    minContextSlot,
  });
  let returnedSignature;
  try {
    returnedSignature = await connection.sendRawTransaction(attempt.raw, {
      skipPreflight: false,
      preflightCommitment: "processed",
      maxRetries: 0,
      minContextSlot,
    });
  } catch (error) {
    if (isRateLimit(error)) {
      return recordRateLimit(journal, resubmission ? "resubmit-write" : "submit-write", error, {
        signature: attempt.entry.signature,
        offset: attempt.offset,
      });
    }
    await journal.append("submission-unknown", {
      stage: resubmission ? "resubmit-write" : "submit-write",
      signature: attempt.entry.signature,
      offset: attempt.offset,
      errorSha256: sha256Hex(Buffer.from(String(error?.message ?? error), "utf8")),
    });
    throw error;
  }
  assert.equal(returnedSignature, attempt.entry.signature, "RPC returned a different Loader Write signature");
  await journal.append(resubmission ? "resubmitted" : "submitted", {
    signature: attempt.entry.signature,
    offset: attempt.offset,
  });
}

async function signatureStatuses(connection, journal, attempts) {
  const result = new Map();
  for (let start = 0; start < attempts.length; start += 200) {
    const group = attempts.slice(start, start + 200);
    const response = await executeRpc(journal, "signature-statuses", () => connection.getSignatureStatuses(
      group.map((attempt) => attempt.entry.signature),
      { searchTransactionHistory: true },
    ));
    assert.equal(response.value.length, group.length, "signature-status response length changed");
    for (const [index, attempt] of group.entries()) {
      result.set(attempt.entry.signature, response.value[index]);
    }
  }
  return result;
}

async function verifyFinalizedTransaction(connection, journal, attempt) {
  const landed = await executeRpc(journal, "finalized-transaction", () => connection.getTransaction(
    attempt.entry.signature,
    { commitment: "finalized", maxSupportedTransactionVersion: 0 },
  ));
  assert(landed?.meta && landed.meta.err === null, "finalized Loader Write transaction is absent or failed");
  assert.equal(landed.transaction.signatures[0], attempt.entry.signature, "finalized Loader Write signature changed");
  const message = Buffer.from(landed.transaction.message.serialize());
  assert.equal(sha256Hex(message), attempt.entry.messageSha256, "finalized Loader Write message changed");
  if (!attempt.finalized) {
    await journal.append("finalized", {
      signature: attempt.entry.signature,
      offset: attempt.offset,
      slot: landed.slot,
      messageSha256: attempt.entry.messageSha256,
      feeLamports: landed.meta.fee,
      computeUnits: landed.meta.computeUnitsConsumed ?? null,
    });
    attempt.finalized = true;
  }
}

async function pollFinalized(connection, journal, attempts, artifact) {
  const pending = new Map(attempts.map((attempt) => [attempt.entry.signature, attempt]));
  let expiredDuringThisInvocation = false;
  while (pending.size > 0) {
    const current = [...pending.values()];
    const statuses = await signatureStatuses(connection, journal, current);
    const nullAttempts = [];
    for (const attempt of current) {
      const status = statuses.get(attempt.entry.signature);
      if (status?.err) {
        await journal.append("transaction-failed", {
          signature: attempt.entry.signature,
          offset: attempt.offset,
          errorSha256: sha256Hex(Buffer.from(JSON.stringify(status.err), "utf8")),
        });
        throw new Error("a Loader Write transaction finalized with an error");
      }
      if (status?.confirmationStatus === "finalized") {
        await verifyFinalizedTransaction(connection, journal, attempt);
        pending.delete(attempt.entry.signature);
      } else if (status === null) {
        nullAttempts.push(attempt);
      }
    }
    if (nullAttempts.length > 0) {
      const blockHeight = await executeRpc(journal, "finalized-block-height", () => connection.getBlockHeight("finalized"));
      const expired = nullAttempts.filter((attempt) => blockHeight > attempt.entry.lastValidBlockHeight);
      if (expired.length > 0) {
        const state = classifySnapshot(await fetchBufferSnapshot(
          connection,
          (stage, callback) => executeRpc(journal, stage, callback),
        ), artifact);
        for (const attempt of expired) {
          assert(state.zeroOffsets.includes(attempt.offset), "an unconfirmed expired write changed finalized buffer bytes");
          await journal.append("expired-unaccepted", {
            signature: attempt.entry.signature,
            offset: attempt.offset,
            observedBlockHeight: blockHeight,
          });
          attempt.expired = true;
          pending.delete(attempt.entry.signature);
          expiredDuringThisInvocation = true;
        }
      }
    }
    if (pending.size > 0) await delay(1_000);
  }
  if (expiredDuringThisInvocation) {
    throw new RetryOnFreshInvocation("a prepared Loader Write expired unaccepted; rerun with the same armed plan");
  }
}

async function reconcileActiveAttempts(connection, journal, replay, artifact) {
  if (replay.activeAttempts.length === 0) return;
  const state = classifySnapshot(await fetchBufferSnapshot(
    connection,
    (stage, callback) => executeRpc(journal, stage, callback),
  ), artifact);
  assertProgressExplained(state, replay, true);
  const statuses = await signatureStatuses(connection, journal, replay.activeAttempts);
  const toPoll = [];
  let currentBlockHeight;
  for (const attempt of replay.activeAttempts) {
    const status = statuses.get(attempt.entry.signature);
    if (status?.err) {
      await journal.append("transaction-failed", {
        signature: attempt.entry.signature,
        offset: attempt.offset,
        errorSha256: sha256Hex(Buffer.from(JSON.stringify(status.err), "utf8")),
      });
      throw new Error("a journaled Loader Write transaction finalized with an error");
    }
    if (status?.confirmationStatus === "finalized") {
      await verifyFinalizedTransaction(connection, journal, attempt);
      continue;
    }
    if (status !== null) {
      toPoll.push(attempt);
      continue;
    }
    currentBlockHeight ??= await executeRpc(journal, "finalized-block-height", () => connection.getBlockHeight("finalized"));
    if (currentBlockHeight > attempt.entry.lastValidBlockHeight) {
      assert(state.zeroOffsets.includes(attempt.offset), "an expired unconfirmed journaled write changed finalized buffer bytes");
      await journal.append("expired-unaccepted", {
        signature: attempt.entry.signature,
        offset: attempt.offset,
        observedBlockHeight: currentBlockHeight,
      });
      attempt.expired = true;
      continue;
    }
    if (state.zeroOffsets.includes(attempt.offset)) {
      await submitPrepared(connection, journal, attempt, true, state.slot);
    } else {
      assert(state.exactOffsets.includes(attempt.offset), "journaled write range has unexpected finalized bytes");
    }
    toPoll.push(attempt);
  }
  if (toPoll.length > 0) await pollFinalized(connection, journal, toPoll, artifact);
}

async function executeUpload() {
  const value = await context();
  const { plan, planSha256 } = await readPlan(value);
  assert.equal(requiredEnvironment("AMEBA_CEREMONY_ARM"), plan.operationId, "controller buffer upload is not explicitly armed");
  await withExecutionLock(value.runDir, plan.operationId, async () => {
    const journal = await openJournal(value.runDir, plan.operationId);
    try {
      await journal.append("session-started", { planSha256, toolSha256: value.toolSha256 });
      await enforceRecordedBackoff(journal);
      const callRpc = (stage, callback) => executeRpc(journal, stage, callback);
      assert.equal(await callRpc("genesis", () => value.connection.getGenesisHash()), EXPECTED_GENESIS, "state RPC genesis changed");
      const currentSlot = await callRpc("current-slot", () => value.connection.getSlot("finalized"));
      const bufferRentMinimumLamports = await callRpc(
        "buffer-rent",
        () => value.connection.getMinimumBalanceForRentExemption(BUFFER_RAW_BYTES, "finalized"),
      );
      const feePayerBalanceLamports = await callRpc(
        "fee-payer-balance",
        () => value.connection.getBalance(FEE_PAYER, "finalized"),
      );
      assert(currentSlot >= plan.observedSlot, "state RPC slot moved behind the plan observation");
      assert.equal(bufferRentMinimumLamports, plan.bufferRentMinimumLamports, "buffer rent schedule changed after planning");

      let replay = replayJournal(journal.entries, value.artifact);
      if (replay.attemptsByOffset.size === 0) {
        assert(currentSlot <= plan.planValidUntilSlot, "unused controller buffer upload plan expired");
      }
      let state = classifySnapshot(await fetchBufferSnapshot(value.connection, callRpc), value.artifact);
      if (replay.attemptsByOffset.size === 0) {
        assertInitialSnapshot(state);
      } else {
        assertProgressExplained(state, replay, true);
      }

      await reconcileActiveAttempts(value.connection, journal, replay, value.artifact);
      replay = replayJournal(journal.entries, value.artifact);
      state = classifySnapshot(await fetchBufferSnapshot(value.connection, callRpc), value.artifact);
      assertProgressExplained(state, replay, false);

      const remainingFeeCeiling = state.zeroOffsets.length * ESTIMATED_MAX_FEE_PER_WRITE_LAMPORTS;
      assert(feePayerBalanceLamports >= remainingFeeCeiling + FEE_BALANCE_MARGIN_LAMPORTS, "fee payer cannot cover remaining bounded write fees plus margin");

      let batch = replay.maxBatch;
      while (state.zeroOffsets.length > 0) {
        const slot = await callRpc("current-slot", () => value.connection.getSlot("finalized"));
        assert(slot >= plan.observedSlot, "state RPC slot moved behind the plan observation during execution");
        const selectedOffsets = state.zeroOffsets.slice(0, WRITE_BATCH_SIZE);
        batch += 1;
        const latest = await callRpc("latest-blockhash", () => value.connection.getLatestBlockhash("finalized"));
        const prepared = [];
        for (const offset of selectedOffsets) {
          const priorAttempts = replay.attemptsByOffset.get(offset) ?? [];
          const attempt = await appendPrepared(
            journal,
            value.artifact,
            offset,
            latest,
            value.payer,
            value.initializer,
            batch,
            priorAttempts.length + 1,
          );
          prepared.push({
            ...attempt,
            attempt: priorAttempts.length + 1,
            batch,
            expired: false,
            failed: false,
            finalized: false,
            offset,
          });
        }

        const immediate = classifySnapshot(await fetchBufferSnapshot(value.connection, callRpc), value.artifact);
        assertProgressExplained(immediate, replay, false);
        assert(selectedOffsets.every((offset) => immediate.zeroOffsets.includes(offset)), "a selected write range changed after transaction preparation");

        for (const [index, attempt] of prepared.entries()) {
          await submitPrepared(value.connection, journal, attempt, false, immediate.slot);
          if (index + 1 < prepared.length) await delay(WRITE_SUBMISSION_PACING_MS);
        }
        await pollFinalized(value.connection, journal, prepared, value.artifact);

        replay = replayJournal(journal.entries, value.artifact);
        state = classifySnapshot(await fetchBufferSnapshot(value.connection, callRpc), value.artifact);
        assertProgressExplained(state, replay, false);
        assert(selectedOffsets.every((offset) => state.exactOffsets.includes(offset)), "a finalized batch is not present in the buffer");
        await journal.append("batch-verified", {
          batch,
          slot: state.slot,
          selectedOffsets,
          exactChunkCount: state.exactOffsets.length,
          remainingChunkCount: state.zeroOffsets.length,
          bufferRawSha256: state.rawSha256,
          bufferPayloadSha256: state.payloadSha256,
        });
      }

      assert.equal(state.payloadSha256, plan.finalPayloadSha256, "final controller buffer payload hash differs from the exact artifact");
      assert.equal(state.rawSha256, plan.finalRawSha256, "final controller buffer raw hash changed");
      assert.equal(state.exactOffsets.length, TOTAL_CHUNK_COUNT, "final controller buffer chunk verification is incomplete");
      if (!journal.entries.some((entry) => entry.event === "complete")) {
        await journal.append("complete", {
          slot: state.slot,
          exactChunkCount: state.exactOffsets.length,
          payloadSha256: state.payloadSha256,
          rawSha256: state.rawSha256,
          controllerProgramAbsent: true,
          controllerProgramdataAbsent: true,
        });
      }
      console.log(JSON.stringify({
        operationId: plan.operationId,
        exactChunkCount: state.exactOffsets.length,
        payloadSha256: state.payloadSha256,
        controllerProgramDeployed: false,
      }));
    } finally {
      await journal.close();
    }
  });
}

async function main() {
  const mode = process.argv[2];
  assert.equal(process.argv.length, 3, "usage: devnet-controller-buffer-upload.mjs <plan|execute>");
  if (mode === "plan") {
    await planUpload();
  } else if (mode === "execute") {
    await executeUpload();
  } else {
    throw new Error("usage: devnet-controller-buffer-upload.mjs <plan|execute>");
  }
}

try {
  await main();
} catch (error) {
  const errorSha256 = sha256Hex(Buffer.from(`${error?.name ?? "Error"}:${error?.message ?? String(error)}`, "utf8"));
  console.error(JSON.stringify({
    ok: false,
    rateLimited: error instanceof RateLimitExit,
    retryOnFreshInvocation: error instanceof RetryOnFreshInvocation,
    backoff: error instanceof RateLimitExit ? error.metadata : null,
    errorSha256,
  }));
  process.exitCode = error instanceof RateLimitExit ? 75 : 1;
}
