import assert from "node:assert/strict";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as signDetached,
  verify as verifyDetached,
} from "node:crypto";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.umask(0o077);

const KEYPAIR_PATHS_ENVIRONMENT = "AMEBA_CEREMONY_LOCAL_SIGNER_KEYPAIR_PATHS";
const PROVIDER_ID_PREFIX = "ameba-local-bootstrap-keypair-v2";
const SELF_TEST_PREFIX = "ameba-local-bootstrap-signer-self-test-";
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ED25519_PKCS8_SEED_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const ED25519_SPKI_PUBLIC_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const BOOTSTRAP_SIGNER_ALLOWLIST = new Set([
  "G2f6Fv477ZyFbmRFtVr21jf9VufXpiRCxf1e91J6SxxT",
  "7wHuwk8DkqCN7vuEWzLhfLDQeiUUKKYfocjjDL5mxQvZ",
  "CzyGUEVtLg2FTWdZmQ6KZCydw73KutLtE6c5PJgnxQqa",
]);

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function currentUid() {
  return typeof process.getuid === "function" ? process.getuid() : undefined;
}

async function requireSecureDirectory(input, label) {
  assert(typeof input === "string" && path.isAbsolute(input), `${label} path must be absolute`);
  const directory = path.resolve(input);
  const status = await lstat(directory);
  assert(status.isDirectory() && !status.isSymbolicLink(), `${label} must be a real directory`);
  const uid = currentUid();
  if (uid !== undefined) assert.equal(status.uid, uid, `${label} owner changed`);
  assert.equal(status.mode & 0o077, 0, `${label} permissions must exclude group and other access`);
  assert.equal(await realpath(directory), directory, `${label} path must not traverse a symbolic link`);
  return directory;
}

async function requireSecureFileInside(runDir, input, label) {
  assert(typeof input === "string" && path.isAbsolute(input), `${label} path must be absolute`);
  const file = path.resolve(input);
  const relative = path.relative(runDir, file);
  assert(
    relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative),
    `${label} must be inside the secure ceremony run directory`,
  );
  const status = await lstat(file);
  assert(status.isFile() && !status.isSymbolicLink(), `${label} must be a real regular file`);
  const uid = currentUid();
  if (uid !== undefined) assert.equal(status.uid, uid, `${label} owner changed`);
  assert.equal(status.mode & 0o777, 0o600, `${label} permissions must be exactly 0600`);
  assert.equal(status.nlink, 1, `${label} must not be hard-linked`);
  assert.equal(await realpath(file), file, `${label} path must not traverse a symbolic link`);
  return file;
}

function encodeBase58(bytes) {
  assert(bytes instanceof Uint8Array && bytes.length > 0, "base58 input is invalid");
  let zeroCount = 0;
  while (zeroCount < bytes.length && bytes[zeroCount] === 0) zeroCount += 1;
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let encoded = "";
  while (value > 0n) {
    encoded = BASE58_ALPHABET[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  return `${"1".repeat(zeroCount)}${encoded}`;
}

function privateKeyFromSeed(seed) {
  assert(seed instanceof Uint8Array && seed.length === 32, "Ed25519 seed is invalid");
  const der = Buffer.alloc(ED25519_PKCS8_SEED_PREFIX.length + seed.length);
  try {
    ED25519_PKCS8_SEED_PREFIX.copy(der, 0);
    Buffer.from(seed.buffer, seed.byteOffset, seed.byteLength).copy(
      der,
      ED25519_PKCS8_SEED_PREFIX.length,
    );
    return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  } finally {
    der.fill(0);
  }
}

function rawPublicKeyFromPrivate(privateKey) {
  const der = Buffer.from(createPublicKey(privateKey).export({ format: "der", type: "spki" }));
  try {
    assert.equal(
      der.length,
      ED25519_SPKI_PUBLIC_PREFIX.length + 32,
      "derived Ed25519 public-key encoding changed",
    );
    assert(
      der.subarray(0, ED25519_SPKI_PUBLIC_PREFIX.length).equals(ED25519_SPKI_PUBLIC_PREFIX),
      "derived Ed25519 public-key prefix changed",
    );
    return Uint8Array.from(der.subarray(ED25519_SPKI_PUBLIC_PREFIX.length));
  } finally {
    der.fill(0);
  }
}

function publicKeyFromRaw(rawPublicKey) {
  assert(rawPublicKey instanceof Uint8Array && rawPublicKey.length === 32, "Ed25519 public key is invalid");
  const der = Buffer.alloc(ED25519_SPKI_PUBLIC_PREFIX.length + rawPublicKey.length);
  try {
    ED25519_SPKI_PUBLIC_PREFIX.copy(der, 0);
    Buffer.from(
      rawPublicKey.buffer,
      rawPublicKey.byteOffset,
      rawPublicKey.byteLength,
    ).copy(der, ED25519_SPKI_PUBLIC_PREFIX.length);
    return createPublicKey({ key: der, format: "der", type: "spki" });
  } finally {
    der.fill(0);
  }
}

function parseSecretKeyBytes(encodedBytes) {
  assert(Buffer.isBuffer(encodedBytes), "local bootstrap signer keypair bytes are malformed");
  const secretKey = new Uint8Array(64);
  let offset = 0;
  const skipWhitespace = () => {
    while (
      offset < encodedBytes.length
      && [0x09, 0x0a, 0x0d, 0x20].includes(encodedBytes[offset])
    ) offset += 1;
  };
  try {
    skipWhitespace();
    assert.equal(encodedBytes[offset], 0x5b, "local bootstrap signer keypair is malformed");
    offset += 1;
    for (let index = 0; index < secretKey.length; index += 1) {
      skipWhitespace();
      assert(
        offset < encodedBytes.length
          && encodedBytes[offset] >= 0x30
          && encodedBytes[offset] <= 0x39,
        "local bootstrap signer keypair is malformed",
      );
      let value = 0;
      let digits = 0;
      while (
        offset < encodedBytes.length
        && encodedBytes[offset] >= 0x30
        && encodedBytes[offset] <= 0x39
      ) {
        value = (value * 10) + (encodedBytes[offset] - 0x30);
        digits += 1;
        assert(digits <= 3 && value <= 255, "local bootstrap signer keypair byte is malformed");
        offset += 1;
      }
      secretKey[index] = value;
      skipWhitespace();
      const expectedSeparator = index === secretKey.length - 1 ? 0x5d : 0x2c;
      assert.equal(
        encodedBytes[offset],
        expectedSeparator,
        "local bootstrap signer keypair length or separator is malformed",
      );
      offset += 1;
    }
    skipWhitespace();
    assert.equal(offset, encodedBytes.length, "local bootstrap signer keypair has trailing data");
    return secretKey;
  } catch (error) {
    secretKey.fill(0);
    throw error;
  }
}

function parseExplicitKeypairPaths(runDir, configured) {
  assert(
    typeof configured === "string" && configured.length > 0,
    `${KEYPAIR_PATHS_ENVIRONMENT} must explicitly list the required secure keypair paths`,
  );
  const inputs = configured.split(path.delimiter);
  assert(
    inputs.length > 0 && inputs.every((input) => input.length > 0),
    "local signer path list contains an empty entry",
  );
  const resolved = inputs.map((input) => {
    assert(path.isAbsolute(input), "every local signer keypair path must be absolute");
    const file = path.resolve(input);
    const relative = path.relative(runDir, file);
    assert(
      relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative),
      "local signer keypair must be inside the secure ceremony run directory",
    );
    return file;
  });
  assert.equal(new Set(resolved).size, resolved.length, "local signer keypair path is duplicated");
  return resolved;
}

async function loadExactSigner(runDir, file) {
  const secureFile = await requireSecureFileInside(runDir, file, "local bootstrap signer keypair");
  const encodedBytes = await readFile(secureFile);
  let secretKey;
  try {
    secretKey = parseSecretKeyBytes(encodedBytes);
  } finally {
    encodedBytes.fill(0);
  }
  const seed = Uint8Array.from(secretKey.subarray(0, 32));
  let derivedPublicKey;
  try {
    derivedPublicKey = rawPublicKeyFromPrivate(privateKeyFromSeed(seed));
    assert(
      Buffer.from(derivedPublicKey).equals(Buffer.from(secretKey.subarray(32))),
      "local bootstrap signer keypair public half does not match its seed",
    );
    return {
      address: encodeBase58(derivedPublicKey),
      publicKey: derivedPublicKey,
      secretKey,
    };
  } catch (error) {
    if (derivedPublicKey) derivedPublicKey.fill(0);
    secretKey.fill(0);
    throw error;
  } finally {
    seed.fill(0);
  }
}

function signerKeyAddress(key) {
  assert(key && typeof key.toBase58 === "function", "transaction signer key is invalid");
  const address = key.toBase58();
  assert(typeof address === "string" && address.length > 0, "transaction signer identity is invalid");
  return address;
}

function transactionMessageAndSigners(transaction) {
  if (transaction?.message && typeof transaction.message.serialize === "function") {
    assert(
      transaction.message.header
        && Number.isSafeInteger(transaction.message.header.numRequiredSignatures)
        && transaction.message.header.numRequiredSignatures > 0,
      "versioned transaction signer count is invalid",
    );
    assert(Array.isArray(transaction.message.staticAccountKeys), "versioned transaction signer keys are invalid");
    assert(Array.isArray(transaction.signatures), "versioned transaction signatures are invalid");
    const signerCount = transaction.message.header.numRequiredSignatures;
    assert.equal(transaction.signatures.length, signerCount, "versioned transaction signature count changed");
    return {
      messageBytes: Buffer.from(transaction.message.serialize()),
      signerAddresses: transaction.message.staticAccountKeys.slice(0, signerCount).map(signerKeyAddress),
      versioned: true,
    };
  }
  assert(
    transaction && typeof transaction.serializeMessage === "function" && Array.isArray(transaction.signatures),
    "local bootstrap signer received an unsupported transaction",
  );
  assert(transaction.signatures.length > 0, "legacy transaction signer list is empty");
  return {
    messageBytes: Buffer.from(transaction.serializeMessage()),
    signerAddresses: transaction.signatures.map((entry) => signerKeyAddress(entry.publicKey)),
    versioned: false,
  };
}

function assignSignature(transaction, versioned, index, signature) {
  assert(Buffer.isBuffer(signature) && signature.length === 64, "local signer produced an invalid signature");
  if (versioned) {
    transaction.signatures[index] = Uint8Array.from(signature);
    return;
  }
  assert(transaction.signatures[index], "legacy transaction signer entry is absent");
  transaction.signatures[index].signature = Buffer.from(signature);
}

function assignedSignature(transaction, versioned, index) {
  const value = versioned
    ? transaction.signatures[index]
    : transaction.signatures[index]?.signature;
  assert(value, `local signer signature ${index} is absent`);
  const signature = Buffer.from(value);
  assert.equal(signature.length, 64, `local signer signature ${index} length changed`);
  return signature;
}

function clearSignerRecords(configuredByAddress) {
  for (const record of configuredByAddress.values()) {
    record.secretKey.fill(0);
    record.publicKey.fill(0);
  }
  configuredByAddress.clear();
}

function assertExpectedSignerSet(
  configuredByAddress,
  allowedSignerAddresses,
  expectedSignerPubkeys,
  transactionSignerAddresses,
) {
  assert(Array.isArray(expectedSignerPubkeys) && expectedSignerPubkeys.length > 0, "expected signer list is empty");
  assert(
    expectedSignerPubkeys.every((address) => typeof address === "string" && allowedSignerAddresses.has(address)),
    "expected signer identity is not an allowed bootstrap signer",
  );
  assert.equal(new Set(expectedSignerPubkeys).size, expectedSignerPubkeys.length, "expected signer identity is duplicated");
  assert.deepEqual(
    transactionSignerAddresses,
    expectedSignerPubkeys,
    "transaction signer identity or order changed",
  );
  assert.deepEqual(
    [...configuredByAddress.keys()].sort(),
    [...expectedSignerPubkeys].sort(),
    "configured signer paths do not exactly match the required signer set",
  );
}

async function createSignerProviderImpl(
  { runDir },
  allowedSignerAddresses,
  moduleFile = fileURLToPath(import.meta.url),
) {
  assert(allowedSignerAddresses instanceof Set && allowedSignerAddresses.size > 0, "local signer allowlist is invalid");
  const secureRunDir = await requireSecureDirectory(runDir, "ceremony run directory");
  await requireSecureFileInside(secureRunDir, path.resolve(moduleFile), "ceremony signer-provider module");
  const files = parseExplicitKeypairPaths(
    secureRunDir,
    process.env[KEYPAIR_PATHS_ENVIRONMENT],
  );
  const configuredByAddress = new Map();
  try {
    for (const file of files) {
      const signer = await loadExactSigner(secureRunDir, file);
      if (!allowedSignerAddresses.has(signer.address)) {
        signer.secretKey.fill(0);
        signer.publicKey.fill(0);
        throw new Error("configured keypair is not an allowed bootstrap signer");
      }
      if (configuredByAddress.has(signer.address)) {
        signer.secretKey.fill(0);
        signer.publicKey.fill(0);
        throw new Error("local signer identity is duplicated across configured paths");
      }
      configuredByAddress.set(signer.address, signer);
    }
  } catch (error) {
    clearSignerRecords(configuredByAddress);
    throw error;
  }
  assert(configuredByAddress.size > 0, "no local bootstrap signers were configured");
  const identityCommitment = sha256Hex(
    Buffer.from([...configuredByAddress.keys()].sort().join("\n"), "utf8"),
  );
  let consumed = false;
  return {
    id: `${PROVIDER_ID_PREFIX}/${identityCommitment}`,
    kind: "wallet",
    async signTransaction({
      expectedSignerPubkeys,
      messageSha256,
      operationId,
      stage,
      transaction,
    }) {
      assert.equal(consumed, false, "local bootstrap signer provider is single-use");
      consumed = true;
      try {
        assert(/^[0-9a-f]{64}$/u.test(operationId), "local signer operation ID is invalid");
        assert(typeof stage === "string" && /^[a-z0-9][a-z0-9-]*$/u.test(stage), "local signer stage is invalid");
        assert(/^[0-9a-f]{64}$/u.test(messageSha256), "local signer message commitment is invalid");
        const before = transactionMessageAndSigners(transaction);
        assert.equal(sha256Hex(before.messageBytes), messageSha256, "local signer message commitment changed");
        assertExpectedSignerSet(
          configuredByAddress,
          allowedSignerAddresses,
          expectedSignerPubkeys,
          before.signerAddresses,
        );
        for (let index = 0; index < expectedSignerPubkeys.length; index += 1) {
          const signer = configuredByAddress.get(expectedSignerPubkeys[index]);
          assert(signer, `local signer ${index} is absent`);
          const privateKey = privateKeyFromSeed(signer.secretKey.subarray(0, 32));
          const signature = signDetached(null, before.messageBytes, privateKey);
          try {
            assert.equal(signature.length, 64, `local signer signature ${index} length changed`);
            assert(
              verifyDetached(null, before.messageBytes, publicKeyFromRaw(signer.publicKey), signature),
              `local signer signature ${index} failed local verification`,
            );
            assignSignature(transaction, before.versioned, index, signature);
          } finally {
            signature.fill(0);
          }
        }
        const after = transactionMessageAndSigners(transaction);
        assert(after.messageBytes.equals(before.messageBytes), "local signer changed the exact transaction message");
        assert.deepEqual(
          after.signerAddresses,
          expectedSignerPubkeys,
          "local signer changed signer identity or order",
        );
        for (let index = 0; index < expectedSignerPubkeys.length; index += 1) {
          const signature = assignedSignature(transaction, after.versioned, index);
          try {
            const signer = configuredByAddress.get(expectedSignerPubkeys[index]);
            assert(
              signer && verifyDetached(null, after.messageBytes, publicKeyFromRaw(signer.publicKey), signature),
              `local signer signature ${index} is invalid after assignment`,
            );
          } finally {
            signature.fill(0);
          }
        }
        return transaction;
      } finally {
        clearSignerRecords(configuredByAddress);
      }
    },
  };
}

export async function createSignerProvider(context) {
  return createSignerProviderImpl(context, BOOTSTRAP_SIGNER_ALLOWLIST);
}

function syntheticSigner(seedBytes) {
  const seed = Uint8Array.from(seedBytes);
  const publicKey = rawPublicKeyFromPrivate(privateKeyFromSeed(seed));
  const secretKey = new Uint8Array(64);
  secretKey.set(seed, 0);
  secretKey.set(publicKey, 32);
  seed.fill(0);
  return {
    address: encodeBase58(publicKey),
    publicKey,
    secretKey,
  };
}

async function writeSyntheticKeypair(directory, name, secretKey, mode = 0o600) {
  const file = path.join(directory, name);
  await writeFile(file, `${JSON.stringify([...secretKey])}\n`, { flag: "wx", mode });
  await chmod(file, mode);
  return file;
}

function fakePublicKey(address) {
  return Object.freeze({ toBase58: () => address });
}

function fakeLegacyTransaction(addresses, messageBytes) {
  const message = Buffer.from(messageBytes);
  return {
    signatures: addresses.map((address) => ({ publicKey: fakePublicKey(address), signature: null })),
    serializeMessage: () => Buffer.from(message),
  };
}

function fakeVersionedTransaction(addresses, messageBytes) {
  const message = Buffer.from(messageBytes);
  return {
    message: {
      header: { numRequiredSignatures: addresses.length },
      staticAccountKeys: addresses.map(fakePublicKey),
      serialize: () => Uint8Array.from(message),
    },
    signatures: addresses.map(() => new Uint8Array(64)),
  };
}

function verifySyntheticTransaction(transaction, versioned, messageBytes, signerByAddress) {
  const surface = transactionMessageAndSigners(transaction);
  assert.equal(surface.versioned, versioned, "synthetic transaction type changed");
  assert(surface.messageBytes.equals(messageBytes), "synthetic provider changed the message");
  for (let index = 0; index < surface.signerAddresses.length; index += 1) {
    const signer = signerByAddress.get(surface.signerAddresses[index]);
    const signature = assignedSignature(transaction, versioned, index);
    try {
      assert(
        signer && verifyDetached(null, messageBytes, publicKeyFromRaw(signer.publicKey), signature),
        `synthetic signature ${index} is invalid`,
      );
    } finally {
      signature.fill(0);
    }
  }
}

async function withSyntheticEnvironment(callback) {
  const parent = path.resolve(tmpdir());
  const directory = await mkdtemp(path.join(parent, SELF_TEST_PREFIX));
  await chmod(directory, 0o700);
  const previous = process.env[KEYPAIR_PATHS_ENVIRONMENT];
  try {
    await requireSecureDirectory(directory, "self-test directory");
    return await callback(directory);
  } finally {
    if (previous === undefined) delete process.env[KEYPAIR_PATHS_ENVIRONMENT];
    else process.env[KEYPAIR_PATHS_ENVIRONMENT] = previous;
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), parent, "refusing to remove a self-test directory outside the temporary parent");
    assert(path.basename(resolved).startsWith(SELF_TEST_PREFIX), "refusing to remove a path without the self-test prefix");
    await rm(resolved, { recursive: true, force: true, maxRetries: 0 });
  }
}

async function selfTest() {
  return withSyntheticEnvironment(async (directory) => {
    const payer = syntheticSigner(Uint8Array.from({ length: 32 }, (_, index) => index + 1));
    const initializer = syntheticSigner(Uint8Array.from({ length: 32 }, (_, index) => index + 33));
    const program = syntheticSigner(Uint8Array.from({ length: 32 }, (_, index) => index + 65));
    const signers = [payer, initializer, program];
    try {
      assert.equal(payer.address, "9C6hybhQ6Aycep9jaUnP6uL9ZYvDjUp1aSkFWPUFJtpj", "synthetic payer base58 vector changed");
      assert.equal(initializer.address, "GcQfK48DV9BzDuDeCyV2sShbAAY4vqmK8JSj1NBrwoVZ", "synthetic initializer base58 vector changed");
      assert.equal(program.address, "ChGSi3SQoGNfykVNnutunLU2HDPVdYeofrw2VU3ANuae", "synthetic Program base58 vector changed");
      const moduleFile = path.join(directory, "installed-provider.mjs");
      await writeFile(moduleFile, "export const installed = true;\n", { flag: "wx", mode: 0o600 });
      await chmod(moduleFile, 0o600);
      const payerFile = await writeSyntheticKeypair(directory, "payer.json", payer.secretKey);
      const initializerFile = await writeSyntheticKeypair(directory, "initializer.json", initializer.secretKey);
      const programFile = await writeSyntheticKeypair(directory, "program.json", program.secretKey);
      const duplicateFile = await writeSyntheticKeypair(directory, "duplicate-payer.json", payer.secretKey);
      const malformedSecret = Uint8Array.from(payer.secretKey);
      malformedSecret[63] ^= 1;
      const malformedFile = await writeSyntheticKeypair(directory, "malformed-public-half.json", malformedSecret);
      malformedSecret.fill(0);
      const broadFile = await writeSyntheticKeypair(directory, "broad-mode.json", payer.secretKey, 0o644);
      const syntheticAllowlist = new Set(signers.map((signer) => signer.address));
      const signerByAddress = new Map(signers.map((signer) => [signer.address, signer]));
      const createSyntheticProvider = (context) => createSignerProviderImpl(
        context,
        syntheticAllowlist,
        moduleFile,
      );

      const legacyAddresses = [payer.address, program.address, initializer.address];
      const legacyMessage = Buffer.from("ameba-local-bootstrap-legacy-self-test-v2", "utf8");
      const legacy = fakeLegacyTransaction(legacyAddresses, legacyMessage);
      process.env[KEYPAIR_PATHS_ENVIRONMENT] = [payerFile, programFile, initializerFile].join(path.delimiter);
      const legacyProvider = await createSyntheticProvider({ runDir: directory });
      await legacyProvider.signTransaction({
        expectedSignerPubkeys: legacyAddresses,
        messageSha256: sha256Hex(legacyMessage),
        operationId: "1".repeat(64),
        stage: "synthetic-legacy",
        transaction: legacy,
      });
      verifySyntheticTransaction(legacy, false, legacyMessage, signerByAddress);
      await assert.rejects(
        () => legacyProvider.signTransaction({
          expectedSignerPubkeys: legacyAddresses,
          messageSha256: sha256Hex(legacyMessage),
          operationId: "1".repeat(64),
          stage: "synthetic-legacy",
          transaction: legacy,
        }),
        undefined,
        "local signer self-test accepted provider reuse",
      );

      const v0Message = Buffer.from("ameba-local-bootstrap-versioned-self-test-v2", "utf8");
      const versioned = fakeVersionedTransaction([payer.address], v0Message);
      process.env[KEYPAIR_PATHS_ENVIRONMENT] = payerFile;
      const versionedProvider = await createSyntheticProvider({ runDir: directory });
      await versionedProvider.signTransaction({
        expectedSignerPubkeys: [payer.address],
        messageSha256: sha256Hex(v0Message),
        operationId: "2".repeat(64),
        stage: "synthetic-v0",
        transaction: versioned,
      });
      verifySyntheticTransaction(versioned, true, v0Message, signerByAddress);

      const negativeCases = ["single-use"];
      const expectReject = async (label, callback) => {
        await assert.rejects(callback, undefined, `local signer self-test accepted ${label}`);
        negativeCases.push(label);
      };
      delete process.env[KEYPAIR_PATHS_ENVIRONMENT];
      await expectReject("missing-path-list", () => createSyntheticProvider({ runDir: directory }));
      process.env[KEYPAIR_PATHS_ENVIRONMENT] = [payerFile, payerFile].join(path.delimiter);
      await expectReject("duplicate-path", () => createSyntheticProvider({ runDir: directory }));
      process.env[KEYPAIR_PATHS_ENVIRONMENT] = fileURLToPath(import.meta.url);
      await expectReject("outside-run-directory", () => createSyntheticProvider({ runDir: directory }));
      process.env[KEYPAIR_PATHS_ENVIRONMENT] = [payerFile, duplicateFile].join(path.delimiter);
      await expectReject("duplicate-identity", () => createSyntheticProvider({ runDir: directory }));
      process.env[KEYPAIR_PATHS_ENVIRONMENT] = malformedFile;
      await expectReject("mismatched-public-half", () => createSyntheticProvider({ runDir: directory }));
      process.env[KEYPAIR_PATHS_ENVIRONMENT] = broadFile;
      await expectReject("broad-keypair-mode", () => createSyntheticProvider({ runDir: directory }));
      process.env[KEYPAIR_PATHS_ENVIRONMENT] = payerFile;
      await expectReject("production-allowlist", () => createSignerProviderImpl(
        { runDir: directory },
        BOOTSTRAP_SIGNER_ALLOWLIST,
        moduleFile,
      ));
      await expectReject("module-outside-run-directory", () => createSignerProviderImpl(
        { runDir: directory },
        syntheticAllowlist,
        fileURLToPath(import.meta.url),
      ));

      process.env[KEYPAIR_PATHS_ENVIRONMENT] = [payerFile, initializerFile].join(path.delimiter);
      const extraProvider = await createSyntheticProvider({ runDir: directory });
      const extraTransaction = fakeVersionedTransaction([payer.address], v0Message);
      await expectReject("extra-signer", () => extraProvider.signTransaction({
        expectedSignerPubkeys: [payer.address],
        messageSha256: sha256Hex(v0Message),
        operationId: "3".repeat(64),
        stage: "synthetic-extra",
        transaction: extraTransaction,
      }));

      process.env[KEYPAIR_PATHS_ENVIRONMENT] = payerFile;
      const missingProvider = await createSyntheticProvider({ runDir: directory });
      const missingTransaction = fakeLegacyTransaction([payer.address, initializer.address], legacyMessage);
      await expectReject("missing-signer", () => missingProvider.signTransaction({
        expectedSignerPubkeys: [payer.address, initializer.address],
        messageSha256: sha256Hex(legacyMessage),
        operationId: "4".repeat(64),
        stage: "synthetic-missing",
        transaction: missingTransaction,
      }));

      process.env[KEYPAIR_PATHS_ENVIRONMENT] = [payerFile, initializerFile].join(path.delimiter);
      const orderProvider = await createSyntheticProvider({ runDir: directory });
      const orderTransaction = fakeLegacyTransaction([payer.address, initializer.address], legacyMessage);
      await expectReject("signer-order", () => orderProvider.signTransaction({
        expectedSignerPubkeys: [initializer.address, payer.address],
        messageSha256: sha256Hex(legacyMessage),
        operationId: "5".repeat(64),
        stage: "synthetic-order",
        transaction: orderTransaction,
      }));

      process.env[KEYPAIR_PATHS_ENVIRONMENT] = payerFile;
      const wrongMessageProvider = await createSyntheticProvider({ runDir: directory });
      const wrongMessageTransaction = fakeVersionedTransaction([payer.address], v0Message);
      await expectReject("message-commitment", () => wrongMessageProvider.signTransaction({
        expectedSignerPubkeys: [payer.address],
        messageSha256: "0".repeat(64),
        operationId: "6".repeat(64),
        stage: "synthetic-message",
        transaction: wrongMessageTransaction,
      }));

      return {
        ok: true,
        provider: PROVIDER_ID_PREFIX,
        runtimeDependencies: ["node-builtins"],
        positiveCases: ["legacy-three-signer", "v0-one-signer"],
        negativeCases,
      };
    } finally {
      for (const signer of signers) {
        signer.secretKey.fill(0);
        signer.publicKey.fill(0);
      }
    }
  });
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  assert.equal(process.argv.length, 3, "usage: local-bootstrap-keypair-signer-provider.mjs self-test");
  assert.equal(process.argv[2], "self-test", "usage: local-bootstrap-keypair-signer-provider.mjs self-test");
  process.stdout.write(`${JSON.stringify(await selfTest())}\n`);
}
