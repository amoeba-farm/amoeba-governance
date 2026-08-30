import assert from "node:assert/strict";
import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";
import { chmod, lstat, open, readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import bs58Module from "bs58";
import { Keypair, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

import { requireSecureDirectory, requireSecureRegularFile } from "./secure-rpc-env.mjs";

process.umask(0o077);

const bs58 = bs58Module.default ?? bs58Module;
const ZERO_HASH = "0".repeat(64);
const JOURNAL_VERSION = 1;
const MAX_PACKET_BYTES = 1_232;
export const CEREMONY_RPC_OWNER_LOCK_NAME = "release1-devnet-rpc-owner";
export const FINALIZED_TRANSACTION_POLL_INTERVAL_MS = 30_000;
export const MINIMUM_RPC_RATE_LIMIT_BACKOFF_MS = 30_000;
const MINIMUM_CONTEXT_CATCH_UP_MAX_ATTEMPTS = 20;
const MINIMUM_CONTEXT_CATCH_UP_DELAY_MS = 2_000;
const MINIMUM_CONTEXT_CATCH_UP_READ_METHODS = new Set([
  "confirmTransaction",
  "getAccountInfo",
  "getAccountInfoAndContext",
  "getAddressLookupTable",
  "getBlockHeight",
  "getGenesisHash",
  "getLatestBlockhash",
  "getLatestBlockhashAndContext",
  "getMinimumBalanceForRentExemption",
  "getMultipleAccountsInfoAndContext",
  "getSignatureStatuses",
  "getSlot",
  "getTransaction",
  "isBlockhashValid",
  "simulateTransaction",
]);
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const PROTECTED_JOURNAL_FIELDS = new Set([
  "journalVersion",
  "sequence",
  "timestamp",
  "operationId",
  "previousEntrySha256",
  "event",
  "entrySha256",
]);

export class RpcBackoffExit extends Error {
  constructor(retryAfterMs) {
    super(`Devnet RPC rate limit encountered; retry no earlier than ${retryAfterMs} ms`);
    this.name = "RpcBackoffExit";
    this.retryAfterMs = retryAfterMs;
  }
}

export async function assertRunDirectoryBackoffElapsed(runDirInput) {
  const runDir = await requireSecureDirectory(runDirInput, "ceremony run directory");
  let latestRetryNotBefore = null;
  for (const name of (await readdir(runDir)).filter((entry) => entry.endsWith(".jsonl")).sort()) {
    const file = await requireSecureRegularFile(path.join(runDir, name), `ceremony journal ${name}`);
    const text = await readFile(file, "utf8");
    assert(text.length === 0 || text.endsWith("\n"), `ceremony journal ${name} has a partial tail`);
    for (const [index, line] of text.split("\n").entries()) {
      if (line.length === 0) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        throw new Error(`ceremony journal ${name} line ${index + 1} is not JSON`);
      }
      if (!["rate-limited", "rpc-rate-limit-exit", "backoff-derived"].includes(entry?.event)) continue;
      let retryNotBefore = entry.retryNotBefore
        ?? entry.payload?.retryNotBefore
        ?? entry.nextAttemptNotBefore
        ?? entry.payload?.nextAttemptNotBefore;
      if (retryNotBefore === undefined && entry.event === "rate-limited") {
        assert(
          typeof entry.timestamp === "string" && Number.isFinite(Date.parse(entry.timestamp)),
          `ceremony journal ${name} has a rate limit without a valid timestamp`,
        );
        // Older uploader journals recorded the 429 first and derived their
        // explicit backoff in a later event. Until that later event is seen,
        // use the reviewed maximum 15-minute delay rather than treating the
        // missing field as permission to continue.
        retryNotBefore = new Date(Date.parse(entry.timestamp) + 15 * 60_000).toISOString();
      }
      assert(
        typeof retryNotBefore === "string" && Number.isFinite(Date.parse(retryNotBefore)),
        `ceremony journal ${name} has a malformed retry-not-before`,
      );
      if (latestRetryNotBefore === null || Date.parse(retryNotBefore) > Date.parse(latestRetryNotBefore)) {
        latestRetryNotBefore = retryNotBefore;
      }
    }
  }
  if (latestRetryNotBefore === null) return;
  const remaining = Date.parse(latestRetryNotBefore) - Date.now();
  if (remaining > 0) throw new RpcBackoffExit(remaining);
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function stableJson(value) {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError("value is not JSON encodable");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([field, entry]) => `${JSON.stringify(field)}:${stableJson(entry)}`)
    .join(",")}}`;
}

function journalEntryHash(material) {
  return createHash("sha256")
    .update("AMOEBA_DEVNET_CEREMONY_JOURNAL_ENTRY_V1", "ascii")
    .update(stableJson(material), "utf8")
    .digest("hex");
}

export function operationId(material) {
  return sha256Hex(Buffer.from(JSON.stringify(material), "utf8"));
}

export function assertExactKeys(value, keys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} keys changed`);
}

export async function writeExclusiveJson(file, value) {
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(file, 0o600);
}

export async function loadSecureKeypair(file, expected, label) {
  const secureFile = await requireSecureRegularFile(file, `${label} keypair`);
  const encoded = JSON.parse(await readFile(secureFile, "utf8"));
  assert(Array.isArray(encoded) && encoded.length === 64, `${label} keypair is malformed`);
  assert(encoded.every((value) => Number.isInteger(value) && value >= 0 && value <= 255), `${label} keypair bytes are malformed`);
  const signer = Keypair.fromSecretKey(Uint8Array.from(encoded));
  assert(signer.publicKey.equals(expected), `${label} identity changed`);
  return signer;
}

export async function loadInjectedSignerProvider(
  runDirInput,
  environmentName = "AMEBA_CEREMONY_SIGNER_PROVIDER",
) {
  assert(/^[A-Z][A-Z0-9_]*$/u.test(environmentName), "signer-provider environment name is invalid");
  const configured = process.env[environmentName];
  assert(
    typeof configured === "string" && configured.trim().length > 0,
    `${environmentName} must name an explicit signer-provider module; no keypair-file fallback exists`,
  );
  const runDir = await requireSecureDirectory(runDirInput, "ceremony run directory");
  const moduleFile = await requireSecureRegularFile(
    path.resolve(configured),
    "ceremony signer-provider module",
  );
  const moduleSha256 = sha256Hex(await readFile(moduleFile));
  const imported = await import(`${pathToFileURL(moduleFile).href}?sha256=${moduleSha256}`);
  assert.equal(
    typeof imported.createSignerProvider,
    "function",
    "signer-provider module must export createSignerProvider",
  );
  const provider = await imported.createSignerProvider({
    environmentName,
    runDir,
  });
  assertExactKeys(provider, ["id", "kind", "signTransaction"], "ceremony signer provider");
  assert(
    typeof provider.id === "string" && /^[a-z0-9][a-z0-9._:/-]{0,255}$/u.test(provider.id),
    "signer-provider ID is invalid",
  );
  assert(
    ["hardware-wallet", "kms", "smart-account", "wallet"].includes(provider.kind),
    "signer-provider kind is unsupported",
  );
  assert.equal(typeof provider.signTransaction, "function", "signer-provider signing function is absent");
  return Object.freeze({
    id: provider.id,
    kind: provider.kind,
    moduleSha256,
    signTransaction: provider.signTransaction.bind(provider),
  });
}

function signerSurface(transaction, allowAbsentSignatures = false) {
  if (transaction?.message && typeof transaction.message.serialize === "function") {
    const signerKeys = transaction.message.staticAccountKeys.slice(
      0,
      transaction.message.header.numRequiredSignatures,
    );
    return {
      messageBytes: Buffer.from(transaction.message.serialize()),
      signatures: transaction.signatures.map((signature) => Buffer.from(signature)),
      signerKeys,
    };
  }
  assert(
    transaction && typeof transaction.serializeMessage === "function" && Array.isArray(transaction.signatures),
    "signer provider returned an unsupported transaction surface",
  );
  return {
    messageBytes: Buffer.from(transaction.serializeMessage()),
    signatures: transaction.signatures.map((entry) => {
      if (allowAbsentSignatures && entry.signature === null) return Buffer.alloc(0);
      assert(entry.signature, "signer provider left a required legacy signature absent");
      return Buffer.from(entry.signature);
    }),
    signerKeys: transaction.signatures.map((entry) => entry.publicKey),
  };
}

export async function signTransactionWithProvider({
  providerValue,
  transaction,
  expectedSigners,
  operationId: operationIdValue,
  stage,
}) {
  assert(providerValue && typeof providerValue.signTransaction === "function", "signer provider is absent");
  assert(/^[0-9a-f]{64}$/u.test(operationIdValue), "signer-provider operation ID is invalid");
  assert(typeof stage === "string" && /^[a-z0-9][a-z0-9-]*$/u.test(stage), "signer-provider stage is invalid");
  assert(Array.isArray(expectedSigners) && expectedSigners.length > 0, "signer-provider signer list is empty");
  const before = signerSurface(transaction, true);
  assert.deepEqual(
    before.signerKeys.map((key) => key.toBase58()),
    expectedSigners.map((key) => key.toBase58()),
    "unsigned transaction signer order changed",
  );
  const messageSha256 = sha256Hex(before.messageBytes);
  const signed = await providerValue.signTransaction({
    expectedSignerPubkeys: expectedSigners.map((key) => key.toBase58()),
    messageSha256,
    operationId: operationIdValue,
    stage,
    transaction,
  });
  assert(signed && typeof signed === "object", "signer provider did not return a signed transaction");
  const after = signerSurface(signed);
  assert(after.messageBytes.equals(before.messageBytes), "signer provider changed the exact transaction message");
  assert.deepEqual(
    after.signerKeys.map((key) => key.toBase58()),
    expectedSigners.map((key) => key.toBase58()),
    "signer provider changed signer identity or order",
  );
  assert.equal(after.signatures.length, expectedSigners.length, "signer provider changed signature count");
  for (let index = 0; index < expectedSigners.length; index += 1) {
    const signature = after.signatures[index];
    assert.equal(signature.length, 64, `signer-provider signature ${index} length changed`);
    assert(signature.some((byte) => byte !== 0), `signer-provider signature ${index} is absent`);
    assert(
      verifySignature(null, after.messageBytes, ed25519PublicKey(expectedSigners[index]), signature),
      `signer-provider signature ${index} is invalid`,
    );
  }
  return {
    providerEvidence: {
      providerId: providerValue.id,
      providerKind: providerValue.kind,
      providerModuleSha256: providerValue.moduleSha256,
    },
    transaction: signed,
  };
}

export async function withExecutionLock(runDirInput, name, operationIdValue, callback) {
  assert(/^[a-z0-9][a-z0-9-]*$/u.test(name), "ceremony lock name is invalid");
  assert(/^[0-9a-f]{64}$/u.test(operationIdValue), "ceremony lock operation ID is invalid");
  const runDir = await requireSecureDirectory(runDirInput, "ceremony run directory");
  const lockPath = path.join(runDir, `${name}.lock`);
  const lock = await open(lockPath, "wx", 0o600);
  try {
    await lock.writeFile(`${JSON.stringify({
      lockVersion: 1,
      operationId: operationIdValue,
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
    })}\n`, "utf8");
    await lock.sync();
    return await callback(runDir);
  } finally {
    await lock.close();
    // Controlled exits, including the mandatory first-429 exit, are resumable.
    // A process crash still leaves the lock as an explicit manual boundary.
    await unlink(lockPath);
  }
}

export async function withCeremonyRpcOwnerLock(runDirInput, operationIdValue, callback) {
  return withExecutionLock(
    runDirInput,
    CEREMONY_RPC_OWNER_LOCK_NAME,
    operationIdValue,
    callback,
  );
}

export async function openJournal(runDirInput, name, operationIdValue) {
  assert(/^[a-z0-9][a-z0-9-]*$/u.test(name), "ceremony journal name is invalid");
  assert(/^[0-9a-f]{64}$/u.test(operationIdValue), "ceremony journal operation ID is invalid");
  const runDir = await requireSecureDirectory(runDirInput, "ceremony run directory");
  await assertRunDirectoryBackoffElapsed(runDir);
  const file = path.join(runDir, `${name}.jsonl`);
  let text = "";
  let handle;
  try {
    handle = await open(file, "wx+", 0o600);
    await handle.sync();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const secureFile = await requireSecureRegularFile(file, "ceremony journal");
    const before = await lstat(secureFile);
    text = await readFile(secureFile, "utf8");
    handle = await open(secureFile, "a+");
    const after = await handle.stat();
    assert.equal(after.dev, before.dev, "ceremony journal device changed while opening");
    assert.equal(after.ino, before.ino, "ceremony journal inode changed while opening");
  }
  const status = await handle.stat();
  assert(status.isFile(), "ceremony journal must be a regular file");
  if (typeof process.getuid === "function") assert.equal(status.uid, process.getuid(), "ceremony journal owner changed");
  assert.equal(status.mode & 0o077, 0, "ceremony journal permissions changed");
  assert(text.length === 0 || text.endsWith("\n"), "ceremony journal has a partial tail");
  const entries = text.length === 0
    ? []
    : text.slice(0, -1).split("\n").map((line) => JSON.parse(line));
  let previousEntrySha256 = ZERO_HASH;
  for (const [index, entry] of entries.entries()) {
    assert(entry && typeof entry === "object" && !Array.isArray(entry), "ceremony journal entry is malformed");
    assert.equal(entry.journalVersion, JOURNAL_VERSION, "ceremony journal version changed");
    assert.equal(entry.sequence, index + 1, "ceremony journal sequence changed");
    assert.equal(entry.operationId, operationIdValue, "ceremony journal operation changed");
    assert.equal(entry.previousEntrySha256, previousEntrySha256, "ceremony journal hash chain changed");
    assert(typeof entry.timestamp === "string" && Number.isFinite(Date.parse(entry.timestamp)), "ceremony journal timestamp is invalid");
    assert(typeof entry.event === "string" && entry.event.length > 0, "ceremony journal event is invalid");
    const { entrySha256, ...material } = entry;
    assert(/^[0-9a-f]{64}$/u.test(entrySha256), "ceremony journal entry hash is invalid");
    assert.equal(entrySha256, journalEntryHash(material), "ceremony journal entry hash changed");
    previousEntrySha256 = entrySha256;
  }
  return {
    entries,
    file,
    assertBackoffElapsed() {
      const rateLimit = entries.findLast((entry) => entry.event === "rate-limited");
      if (!rateLimit) return;
      assert(typeof rateLimit.retryNotBefore === "string" && Number.isFinite(Date.parse(rateLimit.retryNotBefore)), "journaled RPC backoff is malformed");
      const remaining = Date.parse(rateLimit.retryNotBefore) - Date.now();
      if (remaining > 0) throw new RpcBackoffExit(remaining);
    },
    async append(event, fields = {}) {
      assert(typeof event === "string" && /^[a-z0-9][a-z0-9-]*$/u.test(event), "ceremony journal event is invalid");
      assert(fields && typeof fields === "object" && !Array.isArray(fields), "ceremony journal fields must be an object");
      for (const field of Object.keys(fields)) {
        assert(!PROTECTED_JOURNAL_FIELDS.has(field), `ceremony journal field ${field} is reserved`);
      }
      const material = {
        journalVersion: JOURNAL_VERSION,
        sequence: entries.length + 1,
        timestamp: new Date().toISOString(),
        operationId: operationIdValue,
        previousEntrySha256,
        event,
        ...fields,
      };
      const entry = { ...material, entrySha256: journalEntryHash(material) };
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

function nestedErrorValues(error) {
  const values = [];
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    values.push(current);
    current = current.cause;
  }
  return values;
}

function isRateLimit(error) {
  return /(?:\b429\b|too many requests|rate.?limit)/iu.test(String(error?.message ?? error))
    || nestedErrorValues(error).some((value) => (
      value?.status === 429
      || value?.statusCode === 429
      || value?.response?.status === 429
      || /(?:\b429\b|too many requests|rate.?limit)/iu.test(String(value?.message ?? ""))
    ));
}

function isMinimumContextSlotNotReached(error) {
  const values = nestedErrorValues(error);
  const messages = values.map((value) => String(value?.message ?? value ?? "")).join("\n");
  const hasExactCode = values.some((value) => value?.code === -32016)
    || /(?:^|\D)-32016(?:\D|$)/u.test(messages);
  return hasExactCode
    && /minimum context slot (?:not reached|has not been reached)/iu.test(messages);
}

function retryAfterHeaderMs(error) {
  for (const value of nestedErrorValues(error)) {
    if (Number.isSafeInteger(value?.retryAfterMs) && value.retryAfterMs >= 0) return value.retryAfterMs;
    const header = value?.response?.headers?.get?.("retry-after")
      ?? value?.headers?.get?.("retry-after")
      ?? value?.response?.headers?.["retry-after"]
      ?? value?.headers?.["retry-after"]
      ?? value?.retryAfter;
    if (header === undefined || header === null) continue;
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
    const date = Date.parse(String(header));
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return null;
}

export async function callRpc(journal, stage, callback) {
  assert(typeof stage === "string" && stage.length > 0, "RPC stage is required");
  journal.assertBackoffElapsed();
  try {
    return await callback();
  } catch (error) {
    if (!isRateLimit(error)) throw error;
    const priorRateLimits = journal.entries.filter((entry) => entry.event === "rate-limited").length;
    const exponentialBackoffMs = Math.min(60_000, 1_000 * (2 ** Math.min(priorRateLimits, 6)));
    const headerBackoffMs = retryAfterHeaderMs(error);
    const retryAfterMs = Math.max(
      MINIMUM_RPC_RATE_LIMIT_BACKOFF_MS,
      exponentialBackoffMs,
      headerBackoffMs ?? 0,
    );
    await journal.append("rate-limited", {
      stage,
      rateLimitCount: priorRateLimits + 1,
      retryAfterHeaderMs: headerBackoffMs,
      retryAfterMs,
      retryNotBefore: new Date(Date.now() + retryAfterMs).toISOString(),
      errorSha256: sha256Hex(Buffer.from(String(error?.message ?? error), "utf8")),
    });
    throw new RpcBackoffExit(retryAfterMs);
  }
}

async function callReadRpcWithMinimumContextCatchUp(
  journal,
  stage,
  callback,
  maxAttempts,
  delayMs,
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await callRpc(journal, stage, callback);
    } catch (error) {
      // callRpc already persists a 429 and converts it to the mandatory
      // no-retry exit. Never reinterpret that exit as ordinary node catch-up.
      if (error instanceof RpcBackoffExit) throw error;
      if (!isMinimumContextSlotNotReached(error)) throw error;
      const exhausted = attempt === maxAttempts;
      await journal.append(exhausted ? "minimum-context-catch-up-exhausted" : "minimum-context-catch-up", {
        stage,
        attempt,
        maxAttempts,
        retryDelayMs: exhausted ? 0 : delayMs,
        automaticTransactionRetry: false,
        errorSha256: sha256Hex(Buffer.from(String(error?.message ?? error), "utf8")),
      });
      if (exhausted) throw error;
      await delay(delayMs);
    }
  }
  throw new Error(`${stage} minimum-context catch-up loop terminated unexpectedly`);
}

export function guardRpcConnection(connection, journal, scope, options = {}) {
  assert(typeof scope === "string" && scope.length > 0, "RPC scope is required");
  assert(options && typeof options === "object" && !Array.isArray(options), "RPC guard options are invalid");
  const maxAttempts = options.minimumContextCatchUpMaxAttempts
    ?? MINIMUM_CONTEXT_CATCH_UP_MAX_ATTEMPTS;
  const delayMs = options.minimumContextCatchUpDelayMs
    ?? MINIMUM_CONTEXT_CATCH_UP_DELAY_MS;
  assert(
    Number.isSafeInteger(maxAttempts)
      && maxAttempts >= 1
      && maxAttempts <= MINIMUM_CONTEXT_CATCH_UP_MAX_ATTEMPTS,
    "minimum-context catch-up attempt bound is invalid",
  );
  assert(
    Number.isSafeInteger(delayMs)
      && delayMs >= 0
      && delayMs <= MINIMUM_CONTEXT_CATCH_UP_DELAY_MS,
    "minimum-context catch-up delay is invalid",
  );
  return new Proxy(connection, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      const method = String(property);
      return (...args) => {
        const stage = `${scope}:${method}`;
        const callback = () => value.apply(target, args);
        if (MINIMUM_CONTEXT_CATCH_UP_READ_METHODS.has(method)) {
          return callReadRpcWithMinimumContextCatchUp(
            journal,
            stage,
            callback,
            maxAttempts,
            delayMs,
          );
        }
        return callRpc(journal, stage, callback);
      };
    },
  });
}

function assertLatestBlockhash(latestBlockhash) {
  assert(latestBlockhash && typeof latestBlockhash === "object", "latest blockhash response is malformed");
  assert(typeof latestBlockhash.blockhash === "string", "latest blockhash is malformed");
  assert.equal(bs58.decode(latestBlockhash.blockhash).length, 32, "latest blockhash length changed");
  assert(Number.isSafeInteger(latestBlockhash.lastValidBlockHeight) && latestBlockhash.lastValidBlockHeight > 0, "last valid block height is malformed");
}

function ed25519PublicKey(publicKey) {
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, publicKey.toBuffer()]),
    format: "der",
    type: "spki",
  });
}

function validateSignedTransaction(transaction, latestBlockhash, expectedSigners, expectedPacketBytes) {
  // Do not rely on instanceof: the WSL release path can resolve a second copy
  // of web3.js for an stdin/offline verifier. Validate the exact versioned
  // transaction surface and bytes instead.
  assert(transaction && typeof transaction === "object", "ceremony transaction must be versioned");
  assert(transaction.message && typeof transaction.message.serialize === "function", "ceremony transaction message is malformed");
  assert(typeof transaction.serialize === "function" && Array.isArray(transaction.signatures), "ceremony transaction surface is malformed");
  assertLatestBlockhash(latestBlockhash);
  assert.equal(transaction.message.recentBlockhash, latestBlockhash.blockhash, "transaction blockhash changed");
  assert(Array.isArray(expectedSigners) && expectedSigners.length > 0, "expected signer list is empty");
  const signerKeys = transaction.message.staticAccountKeys.slice(0, transaction.message.header.numRequiredSignatures);
  assert.equal(signerKeys.length, expectedSigners.length, "transaction required signer count changed");
  assert.deepEqual(
    signerKeys.map((key) => key.toBase58()),
    expectedSigners.map((key) => key.toBase58()),
    "transaction signer order changed",
  );
  assert.equal(transaction.signatures.length, expectedSigners.length, "transaction signature vector changed");
  const messageBytes = Buffer.from(transaction.message.serialize());
  for (let index = 0; index < expectedSigners.length; index += 1) {
    const signature = Buffer.from(transaction.signatures[index]);
    assert.equal(signature.length, 64, `transaction signature ${index} length changed`);
    assert(signature.some((byte) => byte !== 0), `transaction signature ${index} is absent`);
    assert(verifySignature(null, messageBytes, ed25519PublicKey(expectedSigners[index]), signature), `transaction signature ${index} is invalid`);
  }
  const wire = Buffer.from(transaction.serialize());
  assert(wire.length <= MAX_PACKET_BYTES, `transaction packet exceeds ${MAX_PACKET_BYTES} bytes`);
  if (expectedPacketBytes !== undefined) {
    assert(Number.isSafeInteger(expectedPacketBytes) && expectedPacketBytes > 0, "expected packet length is invalid");
    assert.equal(wire.length, expectedPacketBytes, "transaction packet length changed");
  }
  return {
    messageBytes,
    signature: bs58.encode(transaction.signatures[0]),
    wire,
  };
}

function preparedAttempts(journal, stage, expectedSigners, expectedPacketBytes) {
  const attempts = [];
  const bySignature = new Map();
  for (const entry of journal.entries) {
    if (entry.stage !== stage) continue;
    if (entry.event === "prepared") {
      assert(!bySignature.has(entry.signature), `${stage} prepared signature is duplicated`);
      assert(typeof entry.wireBase64 === "string" && entry.wireBase64.length > 0, `${stage} prepared wire is absent`);
      const wire = Buffer.from(entry.wireBase64, "base64");
      assert.equal(wire.toString("base64"), entry.wireBase64, `${stage} prepared wire encoding changed`);
      assert.equal(sha256Hex(wire), entry.wireSha256, `${stage} prepared wire hash changed`);
      const transaction = VersionedTransaction.deserialize(wire);
      const validated = validateSignedTransaction(transaction, {
        blockhash: entry.blockhash,
        lastValidBlockHeight: entry.lastValidBlockHeight,
      }, expectedSigners, expectedPacketBytes);
      assert.equal(validated.signature, entry.signature, `${stage} prepared signature changed`);
      assert.equal(sha256Hex(validated.messageBytes), entry.messageSha256, `${stage} prepared message hash changed`);
      assert.equal(wire.length, entry.wireBytes, `${stage} prepared wire length changed`);
      assert.equal(entry.minContextSlot > 0 && Number.isSafeInteger(entry.minContextSlot), true, `${stage} prepared minimum context slot is invalid`);
      assert.deepEqual(entry.expectedSigners, expectedSigners.map((key) => key.toBase58()), `${stage} prepared signer commitment changed`);
      const attempt = {
        entry,
        transaction,
        wire,
        failed: false,
        expired: false,
        finalized: false,
        lastSendContextSlot: entry.minContextSlot,
      };
      attempts.push(attempt);
      bySignature.set(entry.signature, attempt);
      continue;
    }
    if (!["send-prepared", "resubmit-prepared", "submitted", "resubmitted", "submission-unknown", "transaction-failed", "expired-not-landed", "finalized", "reconciled-finalized"].includes(entry.event)) continue;
    const attempt = bySignature.get(entry.signature);
    assert(attempt, `${stage} journal event precedes its prepared transaction`);
    if (["send-prepared", "resubmit-prepared"].includes(entry.event)) {
      assert(Number.isSafeInteger(entry.minContextSlot) && entry.minContextSlot >= attempt.lastSendContextSlot, `${stage} send context regressed`);
      attempt.lastSendContextSlot = entry.minContextSlot;
    }
    if (entry.event === "transaction-failed") attempt.failed = true;
    if (entry.event === "expired-not-landed") {
      assert(Number.isSafeInteger(entry.finalizedProofSlot) && entry.finalizedProofSlot > 0, `${stage} expiry finalized proof slot is invalid`);
      assert(Number.isSafeInteger(entry.prestateProofSlot) && entry.prestateProofSlot >= entry.finalizedProofSlot, `${stage} expiry prestate proof predates finalized context`);
      attempt.expired = true;
    }
    if (entry.event === "finalized" || entry.event === "reconciled-finalized") attempt.finalized = true;
  }
  for (const [index, attempt] of attempts.entries()) {
    assert(!(attempt.failed && (attempt.expired || attempt.finalized)), `${stage} transaction has contradictory terminal events`);
    assert(!(attempt.expired && attempt.finalized), `${stage} transaction is both expired and finalized`);
    if (index < attempts.length - 1) assert(attempt.expired, `${stage} has more than one non-expired prepared transaction`);
  }
  assert(attempts.filter((attempt) => attempt.finalized).length <= 1, `${stage} has more than one finalized transaction`);
  const finalized = attempts.find((attempt) => attempt.finalized) ?? null;
  if (finalized) assert(attempts.at(-1) === finalized, `${stage} has a prepared transaction after finalization`);
  const active = attempts.at(-1);
  return {
    active: active && !active.failed && !active.expired && !active.finalized ? active : null,
    finalized,
  };
}

async function tryFinalizedTransaction(connection, attempt, stage) {
  const landed = await connection.getTransaction(attempt.entry.signature, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  if (landed === null) return null;
  assert(landed.meta, `${stage} finalized transaction metadata is absent`);
  assert.equal(landed.meta.err, null, `${stage} finalized transaction failed`);
  assert.equal(landed.transaction.signatures[0], attempt.entry.signature, `${stage} finalized transaction signature changed`);
  const landedMessage = Buffer.from(landed.transaction.message.serialize());
  assert.equal(sha256Hex(landedMessage), attempt.entry.messageSha256, `${stage} finalized message differs from the signed message`);
  return {
    signature: attempt.entry.signature,
    slot: landed.slot,
    blockTime: landed.blockTime,
    feeLamports: landed.meta.fee,
    computeUnits: landed.meta.computeUnitsConsumed ?? null,
    messageSha256: attempt.entry.messageSha256,
    wireBytes: attempt.entry.wireBytes,
    preparedContext: attempt.entry.preparedContext ?? null,
  };
}

async function finalizedTransaction(connection, attempt, stage) {
  const landed = await tryFinalizedTransaction(connection, attempt, stage);
  assert(landed, `${stage} finalized transaction is absent`);
  return landed;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function assertBlockhashStillValid(connection, attempt, stage) {
  const response = await connection.isBlockhashValid(attempt.blockhash, {
    commitment: "finalized",
    minContextSlot: attempt.minContextSlot,
  });
  assert(response.context.slot >= attempt.minContextSlot, `${stage} blockhash validation predates its required context`);
  assert.equal(response.value, true, `${stage} blockhash is no longer valid`);
}

function verifiedObservationSlot(value, minimumSlot, stage) {
  const slot = Number.isSafeInteger(value)
    ? value
    : value?.currentSlot ?? value?.slot ?? value?.context?.slot;
  assert(Number.isSafeInteger(slot) && slot >= minimumSlot, `${stage} finalized expiry proof predates its required context`);
  return slot;
}

async function proveExpiredNotLanded({
  connection,
  journal,
  attempt,
  stage,
  verifyExpiredPrestate,
}) {
  assert.equal(typeof verifyExpiredPrestate, "function", `${stage} expiry verifier is absent`);
  const blockHeight = await connection.getBlockHeight("finalized");
  if (blockHeight <= attempt.entry.lastValidBlockHeight) return { expired: false, landed: null };
  const statuses = await connection.getSignatureStatuses([attempt.entry.signature], { searchTransactionHistory: true });
  assert.equal(statuses.value.length, 1, `${stage} expiry status response length changed`);
  const status = statuses.value[0];
  if (status?.err) throw new Error(`${stage} expired transaction landed with an error`);
  const landed = await tryFinalizedTransaction(connection, attempt, stage);
  if (landed) return { expired: false, landed };
  assert.equal(status, null, `${stage} transaction is visible but lacks an exact finalized transaction`);
  const finalizedSlot = await connection.getSlot("finalized");
  assert(Number.isSafeInteger(finalizedSlot) && finalizedSlot > 0, `${stage} finalized expiry slot is invalid`);
  const proof = await verifyExpiredPrestate(finalizedSlot);
  const proofSlot = verifiedObservationSlot(proof, finalizedSlot, stage);
  await journal.append("expired-not-landed", {
    stage,
    signature: attempt.entry.signature,
    observedBlockHeight: blockHeight,
    finalizedProofSlot: finalizedSlot,
    prestateProofSlot: proofSlot,
  });
  return { expired: true, landed: null };
}

async function pollPreparedFinalized(
  connection,
  journal,
  attempt,
  stage,
  terminalEvent,
  verifyExpiredPrestate,
) {
  for (;;) {
    const statusResponse = await connection.getSignatureStatuses([attempt.entry.signature], { searchTransactionHistory: true });
    assert.equal(statusResponse.value.length, 1, `${stage} signature-status response length changed`);
    const status = statusResponse.value[0];
    if (status?.err) {
      await journal.append("transaction-failed", {
        stage,
        signature: attempt.entry.signature,
        errorSha256: sha256Hex(Buffer.from(JSON.stringify(status.err), "utf8")),
      });
      throw new Error(`${stage} finalized with an error`);
    }
    if (status?.confirmationStatus === "finalized") {
      const landed = await finalizedTransaction(connection, attempt, stage);
      await journal.append(terminalEvent, { stage, ...landed });
      return landed;
    }
    if (status === null) {
      const blockHeight = await connection.getBlockHeight("finalized");
      if (blockHeight > attempt.entry.lastValidBlockHeight) {
        const proof = await proveExpiredNotLanded({
          connection,
          journal,
          attempt,
          stage,
          verifyExpiredPrestate,
        });
        if (proof.landed) {
          await journal.append(terminalEvent, { stage, ...proof.landed });
          return proof.landed;
        }
        if (proof.expired) return null;
      }
    }
    await delay(FINALIZED_TRANSACTION_POLL_INTERVAL_MS);
  }
}

export async function reconcileOneFinalized({
  connection,
  journal,
  operationId: operationIdValue,
  stage,
  expectedSigners,
  expectedPacketBytes,
  verifyImmediatelyBeforeResubmit,
  verifyExpiredPrestate = verifyImmediatelyBeforeResubmit,
}) {
  assert.equal(journal.entries.every((entry) => entry.operationId === operationIdValue), true, `${stage} journal operation changed`);
  const replay = preparedAttempts(journal, stage, expectedSigners, expectedPacketBytes);
  if (replay.finalized) return finalizedTransaction(connection, replay.finalized, stage);
  const attempt = replay.active;
  if (!attempt) return null;
  const statuses = await connection.getSignatureStatuses([attempt.entry.signature], { searchTransactionHistory: true });
  assert.equal(statuses.value.length, 1, `${stage} reconciliation status response length changed`);
  const status = statuses.value[0];
  if (status?.err) {
    await journal.append("transaction-failed", {
      stage,
      signature: attempt.entry.signature,
      errorSha256: sha256Hex(Buffer.from(JSON.stringify(status.err), "utf8")),
    });
    throw new Error(`${stage} journaled transaction finalized with an error`);
  }
  if (status?.confirmationStatus === "finalized") {
    const landed = await finalizedTransaction(connection, attempt, stage);
    await journal.append("reconciled-finalized", { stage, ...landed });
    return landed;
  }
  // A prepared signature may already have landed even when the original RPC
  // response was lost. Never rebroadcast it automatically. Observe the exact
  // signature until it finalizes or until expiry is independently proven
  // against unchanged finalized prestate; an expired attempt requires a new
  // plan/operation rather than an in-place retry.
  const landed = await pollPreparedFinalized(
    connection,
    journal,
    attempt,
    stage,
    "reconciled-finalized",
    verifyExpiredPrestate,
  );
  if (landed) return landed;
  await journal.append("replan-required", {
    stage,
    signature: attempt.entry.signature,
    reason: "prepared-transaction-expired-not-landed",
    automaticRebroadcast: false,
  });
  throw new Error(`${stage} prepared transaction expired without landing; stop and create a new plan/operation`);
}

export async function submitOneFinalized({
  connection,
  transaction,
  latestBlockhash,
  journal,
  operationId: operationIdValue,
  stage,
  expectedSigners,
  expectedPacketBytes,
  minContextSlot,
  preparedContext = null,
  verifyImmediatelyBeforeSubmit,
  verifyExpiredPrestate = verifyImmediatelyBeforeSubmit,
}) {
  assert(Number.isSafeInteger(minContextSlot) && minContextSlot > 0, `${stage} minimum context slot is invalid`);
  const replay = preparedAttempts(journal, stage, expectedSigners, expectedPacketBytes);
  assert.equal(replay.finalized, null, `${stage} transaction is already finalized`);
  assert.equal(replay.active, null, `${stage} has an unreconciled prepared transaction`);
  const validated = validateSignedTransaction(transaction, latestBlockhash, expectedSigners, expectedPacketBytes);
  await journal.append("prepared", {
    stage,
    signature: validated.signature,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    minContextSlot,
    expectedSigners: expectedSigners.map((key) => key.toBase58()),
    messageSha256: sha256Hex(validated.messageBytes),
    wireSha256: sha256Hex(validated.wire),
    wireBytes: validated.wire.length,
    wireBase64: validated.wire.toString("base64"),
    preparedContext,
  });
  const preSubmit = await verifyImmediatelyBeforeSubmit(minContextSlot);
  const preSubmitSlot = verifiedObservationSlot(preSubmit, minContextSlot, stage);
  await assertBlockhashStillValid(connection, {
    blockhash: latestBlockhash.blockhash,
    minContextSlot: preSubmitSlot,
  }, stage);
  await journal.append("send-prepared", {
    stage,
    signature: validated.signature,
    messageSha256: sha256Hex(validated.messageBytes),
    wireSha256: sha256Hex(validated.wire),
    minContextSlot: preSubmitSlot,
  });
  let submitted;
  try {
    submitted = await connection.sendRawTransaction(validated.wire, {
      skipPreflight: false,
      preflightCommitment: "processed",
      maxRetries: 0,
      minContextSlot: preSubmitSlot,
    });
  } catch (error) {
    if (error instanceof RpcBackoffExit) throw error;
    await journal.append("submission-unknown", {
      stage,
      signature: validated.signature,
      errorSha256: sha256Hex(Buffer.from(String(error?.message ?? error), "utf8")),
    });
    throw new Error(`${stage} submission outcome is unknown; reconcile ${validated.signature}`);
  }
  assert.equal(submitted, validated.signature, `${stage} RPC returned a different signature`);
  await journal.append("submitted", { stage, signature: validated.signature });
  const attempt = preparedAttempts(journal, stage, expectedSigners, expectedPacketBytes).active;
  assert(attempt, `${stage} prepared transaction disappeared from the journal`);
  const landed = await pollPreparedFinalized(
    connection,
    journal,
    attempt,
    stage,
    "finalized",
    verifyExpiredPrestate,
  );
  if (!landed) {
    await journal.append("replan-required", {
      stage,
      signature: validated.signature,
      reason: "submitted-transaction-expired-not-landed",
      automaticRebroadcast: false,
    });
    throw new Error(`${stage} transaction expired before finalized confirmation; stop and create a new plan/operation`);
  }
  return landed;
}

export async function selfTestCeremonyRuntime() {
  assert.equal(CEREMONY_RPC_OWNER_LOCK_NAME, "release1-devnet-rpc-owner");
  assert(FINALIZED_TRANSACTION_POLL_INTERVAL_MS >= 30_000, "finalized transaction polling is too frequent");
  assert(MINIMUM_RPC_RATE_LIMIT_BACKOFF_MS >= 30_000, "RPC rate-limit backoff is too short");

  let rateLimitCalls = 0;
  const rateLimitJournal = {
    entries: [],
    assertBackoffElapsed() {},
    async append(event, fields) {
      this.entries.push({ event, ...fields });
    },
  };
  let rateLimitExit = null;
  try {
    await callRpc(rateLimitJournal, "self-test:429", async () => {
      rateLimitCalls += 1;
      const error = new Error("429 Too Many Requests");
      error.status = 429;
      throw error;
    });
  } catch (error) {
    rateLimitExit = error;
  }
  assert(rateLimitExit instanceof RpcBackoffExit, "first 429 did not produce the controlled backoff exit");
  assert.equal(rateLimitCalls, 1, "first 429 was retried automatically");
  assert.equal(rateLimitJournal.entries.length, 1, "first 429 was not durably represented exactly once");
  assert.equal(rateLimitJournal.entries[0].event, "rate-limited");
  assert(rateLimitJournal.entries[0].retryAfterMs >= MINIMUM_RPC_RATE_LIMIT_BACKOFF_MS);

  const payer = Keypair.generate();
  const blockhash = bs58.encode(Buffer.alloc(32, 7));
  const transaction = new VersionedTransaction(new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [],
  }).compileToV0Message());
  transaction.sign([payer]);
  const wire = Buffer.from(transaction.serialize());
  const messageBytes = Buffer.from(transaction.message.serialize());
  const signature = bs58.encode(transaction.signatures[0]);
  const operationIdValue = "ab".repeat(32);
  const stage = "ambiguous-self-test";
  const prepared = {
    event: "prepared",
    operationId: operationIdValue,
    stage,
    signature,
    blockhash,
    lastValidBlockHeight: 1,
    minContextSlot: 100,
    expectedSigners: [payer.publicKey.toBase58()],
    messageSha256: sha256Hex(messageBytes),
    wireSha256: sha256Hex(wire),
    wireBytes: wire.length,
    wireBase64: wire.toString("base64"),
    preparedContext: null,
  };
  const reconciliationJournal = {
    entries: [prepared],
    async append(event, fields) {
      this.entries.push({ event, operationId: operationIdValue, ...fields });
    },
  };
  let sendCalls = 0;
  const reconciliationConnection = {
    async getSignatureStatuses() { return { value: [null] }; },
    async getBlockHeight() { return 2; },
    async getTransaction() { return null; },
    async getSlot() { return 101; },
    async sendRawTransaction() { sendCalls += 1; return signature; },
  };
  await assert.rejects(
    reconcileOneFinalized({
      connection: reconciliationConnection,
      journal: reconciliationJournal,
      operationId: operationIdValue,
      stage,
      expectedSigners: [payer.publicKey],
      expectedPacketBytes: wire.length,
      verifyImmediatelyBeforeResubmit: async () => {
        throw new Error("automatic rebroadcast callback must remain unreachable");
      },
      verifyExpiredPrestate: async (minimumSlot) => minimumSlot + 1,
    }),
    /stop and create a new plan\/operation/u,
  );
  assert.equal(sendCalls, 0, "ambiguous prepared transaction was rebroadcast");
  assert(
    reconciliationJournal.entries.some((entry) => entry.event === "expired-not-landed"),
    "ambiguous prepared transaction expiry was not proven",
  );
  assert(
    reconciliationJournal.entries.some((entry) => entry.event === "replan-required" && entry.automaticRebroadcast === false),
    "ambiguous prepared transaction did not end at a fail-closed replan boundary",
  );
  return Object.freeze({
    ceremonyRpcOwnerLockName: CEREMONY_RPC_OWNER_LOCK_NAME,
    finalizedTransactionPollIntervalMs: FINALIZED_TRANSACTION_POLL_INTERVAL_MS,
    minimumRpcRateLimitBackoffMs: MINIMUM_RPC_RATE_LIMIT_BACKOFF_MS,
    firstRateLimitCallCount: rateLimitCalls,
    ambiguousPreparedTransactionSendCalls: sendCalls,
    ambiguousPreparedTransactionRequiresReplan: true,
  });
}
