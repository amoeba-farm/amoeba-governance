import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  createHash,
  createPublicKey,
  verify as verifySignature,
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

import { PublicKey, VersionedMessage } from "@solana/web3.js";

import { requireSecureRegularFile } from "./secure-rpc-env.mjs";

const MAX_SOLANA_MESSAGE_BYTES = 1_232;
const TEMP_PREFIX = "ameba-gcp-kms-ed25519-";

// These are the only Devnet ceremony identities this helper may sign for. A
// KMS resource name is not an authority identity: its public key must resolve
// to exactly one of these addresses before gcloud is invoked.
const AUTHORITY_ALLOWLIST = Object.freeze([
  Object.freeze({
    role: "legacy-target-authority",
    address: "D5jhTM3kYHdKixrc52Kn657gBHytQLhQqsTmJBcNFVdq",
    kmsKeyVersion: "projects/amoeba-hm0q2k/locations/global/keyRings/ameba-spread-devnet/cryptoKeys/upgrade-authority-v1/cryptoKeyVersions/1",
  }),
  Object.freeze({
    role: "seat-0",
    address: "pSutXCyMTkwvzG1kpiHXULkVKyzz8NPSNgnjLgwNcTu",
    kmsKeyVersion: "projects/amoeba-hm0q2k/locations/global/keyRings/ameba-spread-devnet/cryptoKeys/governance-seat-1-v1/cryptoKeyVersions/1",
  }),
  Object.freeze({
    role: "seat-1",
    address: "4vrxWeSfCoJA8KvzCcWGgG4C5S4gPYrLaRWysycJeVpz",
    kmsKeyVersion: "projects/amoeba-hm0q2k/locations/global/keyRings/ameba-spread-devnet/cryptoKeys/governance-seat-2-v1/cryptoKeyVersions/1",
  }),
  Object.freeze({
    role: "seat-2",
    address: "DgMGtSjUg1wXPZuPBT6HqGN3qRLVBJCqYrv31XtcwcBR",
    kmsKeyVersion: "projects/amoeba-hm0q2k/locations/global/keyRings/ameba-spread-devnet/cryptoKeys/governance-seat-3-v1/cryptoKeyVersions/1",
  }),
  Object.freeze({
    role: "seat-3",
    address: "4SJyALW3CinnBrFUzHeJL6v5KM12hw2FGLL1wbVTVfn8",
    kmsKeyVersion: "projects/amoeba-hm0q2k/locations/global/keyRings/ameba-spread-devnet/cryptoKeys/governance-seat-4-v1/cryptoKeyVersions/1",
  }),
  Object.freeze({
    role: "seat-4",
    address: "Cmd42MrYC7CVyQNGq7GRkTqR3jQ8cBPKzjzDpsc5eNW4",
    kmsKeyVersion: "projects/amoeba-hm0q2k/locations/global/keyRings/ameba-spread-devnet/cryptoKeys/governance-seat-5-v1/cryptoKeyVersions/1",
  }),
]);

const USAGE = `usage:
  node gcp-kms-ed25519-signer.mjs \\
    --authority <legacy-target-authority|seat-0|seat-1|seat-2|seat-3|seat-4|allowed-address> \\
    --kms-key-version <projects/.../locations/.../keyRings/.../cryptoKeys/.../cryptoKeyVersions/N> \\
    --public-key-pem <secure-ed25519-public-key.pem> \\
    --message <secure-raw-solana-message.bin> \\
    --expected-message-sha256 <lowercase-sha256>

The command emits one JSON object containing the verified 64-byte signature in
base64. It never contacts a Solana RPC and never accepts private-key material.`;

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseArguments(argv) {
  if (argv.length === 1 && argv[0] === "--help") {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  }

  const allowed = new Set([
    "--authority",
    "--kms-key-version",
    "--public-key-pem",
    "--message",
    "--expected-message-sha256",
  ]);
  assert.equal(argv.length, allowed.size * 2, USAGE);
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    assert(allowed.has(flag), `unknown argument ${flag}\n${USAGE}`);
    assert(!parsed.has(flag), `duplicate argument ${flag}`);
    assert(typeof value === "string" && value.length > 0, `${flag} requires a value`);
    parsed.set(flag, value);
  }
  for (const flag of allowed) assert(parsed.has(flag), `missing ${flag}\n${USAGE}`);
  return {
    authority: parsed.get("--authority"),
    kmsKeyVersion: parsed.get("--kms-key-version"),
    publicKeyPem: parsed.get("--public-key-pem"),
    message: parsed.get("--message"),
    expectedMessageSha256: parsed.get("--expected-message-sha256"),
  };
}

function resolveAllowedAuthority(input) {
  const match = AUTHORITY_ALLOWLIST.find(
    ({ role, address }) => input === role || input === address,
  );
  assert(match, "authority is not one of the six fixed Devnet ceremony identities");
  return {
    role: match.role,
    publicKey: new PublicKey(match.address),
    kmsKeyVersion: match.kmsKeyVersion,
  };
}

function parseKmsKeyVersion(resourceName) {
  const match = /^projects\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})\/locations\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})\/keyRings\/([A-Za-z0-9][A-Za-z0-9_-]{0,62})\/cryptoKeys\/([A-Za-z0-9][A-Za-z0-9_-]{0,62})\/cryptoKeyVersions\/([1-9][0-9]*)$/u.exec(resourceName);
  assert(match, "KMS key version must be one canonical full cryptoKeyVersions resource name");
  return {
    project: match[1],
    location: match[2],
    keyRing: match[3],
    key: match[4],
    version: match[5],
  };
}

function decodeAndBindSolanaMessage(messageBytes, expectedAuthority) {
  assert(messageBytes.length > 0, "Solana message is empty");
  assert(
    messageBytes.length <= MAX_SOLANA_MESSAGE_BYTES,
    `Solana message exceeds ${MAX_SOLANA_MESSAGE_BYTES} bytes`,
  );

  let decoded;
  try {
    decoded = VersionedMessage.deserialize(messageBytes);
  } catch {
    throw new Error("message is not a canonical legacy or v0 Solana message");
  }
  assert(
    Buffer.from(decoded.serialize()).equals(messageBytes),
    "Solana message did not round-trip canonically",
  );

  const staticKeys = "staticAccountKeys" in decoded
    ? decoded.staticAccountKeys
    : decoded.accountKeys;
  const requiredSignerCount = decoded.header.numRequiredSignatures;
  assert(
    Number.isSafeInteger(requiredSignerCount)
      && requiredSignerCount > 0
      && requiredSignerCount <= staticKeys.length,
    "Solana message has an invalid required-signer count",
  );
  const signerIndex = staticKeys
    .slice(0, requiredSignerCount)
    .findIndex((key) => key.equals(expectedAuthority));
  assert(signerIndex >= 0, "allowed authority is not a required signer in the Solana message");
  return signerIndex;
}

async function loadAndBindPublicKey(file, expectedAuthority) {
  const secureFile = await requireSecureRegularFile(file, "KMS public PEM");
  const pem = await readFile(secureFile, "utf8");
  const publicKey = createPublicKey(pem);
  assert.equal(publicKey.asymmetricKeyType, "ed25519", "KMS public PEM is not Ed25519");
  const jwk = publicKey.export({ format: "jwk" });
  assert.equal(jwk.kty, "OKP", "KMS public PEM has an unexpected key type");
  assert.equal(jwk.crv, "Ed25519", "KMS public PEM has an unexpected curve");
  assert(typeof jwk.x === "string", "KMS public PEM lacks an Ed25519 public key");
  const rawPublicKey = Buffer.from(jwk.x, "base64url");
  assert.equal(rawPublicKey.length, 32, "KMS Ed25519 public key is not 32 bytes");
  const solanaAddress = new PublicKey(rawPublicKey);
  assert(
    solanaAddress.equals(expectedAuthority),
    `KMS public key resolves to ${solanaAddress.toBase58()}, not the selected allowlisted authority`,
  );
  return publicKey;
}

async function assertSecureTemporaryPath(file, kind, expectedMode) {
  const status = await lstat(file);
  assert(!status.isSymbolicLink(), `temporary ${kind} must not be a symlink`);
  assert(
    kind === "directory" ? status.isDirectory() : status.isFile(),
    `temporary ${kind} has the wrong filesystem type`,
  );
  if (typeof process.getuid === "function") {
    assert.equal(status.uid, process.getuid(), `temporary ${kind} owner changed`);
  }
  assert.equal(status.mode & 0o077, 0, `temporary ${kind} permissions are too broad`);
  assert.equal(status.mode & 0o700, expectedMode, `temporary ${kind} owner permissions changed`);
}

async function createSecureTemporaryDirectory() {
  const parent = await realpath(tmpdir());
  const directory = await mkdtemp(path.join(parent, TEMP_PREFIX));
  await chmod(directory, 0o700);
  await assertSecureTemporaryPath(directory, "directory", 0o700);
  return { parent, directory };
}

async function removeSecureTemporaryDirectory(temporary) {
  const directory = path.resolve(temporary.directory);
  assert.equal(
    path.dirname(directory),
    path.resolve(temporary.parent),
    "refusing to clean a temporary path outside its resolved parent",
  );
  assert(
    path.basename(directory).startsWith(TEMP_PREFIX),
    "refusing to clean a path without the signer temporary prefix",
  );
  await rm(directory, { recursive: true, force: true, maxRetries: 0 });
}

function gcloudFailure(result) {
  const stdout = Buffer.from(result.stdout ?? "", "utf8");
  const stderr = Buffer.from(result.stderr ?? "", "utf8");
  const status = result.status === null ? "no-status" : String(result.status);
  const cause = result.error && typeof result.error === "object" && "code" in result.error
    ? String(result.error.code)
    : "none";
  return new Error(
    `gcloud KMS asymmetric-sign failed (status=${status}, cause=${cause}, stdoutSha256=${sha256Hex(stdout)}, stderrSha256=${sha256Hex(stderr)})`,
  );
}

async function signWithGcloud({ kms, messageBytes }) {
  const temporary = await createSecureTemporaryDirectory();
  const inputFile = path.join(temporary.directory, "solana-message.bin");
  const signatureFile = path.join(temporary.directory, "ed25519-signature.bin");
  try {
    await writeFile(inputFile, messageBytes, { flag: "wx", mode: 0o600 });
    await chmod(inputFile, 0o600);
    await assertSecureTemporaryPath(inputFile, "file", 0o600);

    // EC_SIGN_ED25519 signs raw data. Deliberately do not pass
    // --digest-algorithm and do not prehash the Solana message.
    const executable = process.platform === "win32" ? "gcloud.cmd" : "gcloud";
    const result = spawnSync(executable, [
      "kms",
      "asymmetric-sign",
      `--project=${kms.project}`,
      `--location=${kms.location}`,
      `--keyring=${kms.keyRing}`,
      `--key=${kms.key}`,
      `--version=${kms.version}`,
      `--input-file=${inputFile}`,
      `--signature-file=${signatureFile}`,
      "--quiet",
    ], {
      shell: false,
      windowsHide: true,
      encoding: "utf8",
      maxBuffer: 64 * 1024,
      timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        CLOUDSDK_CORE_DISABLE_PROMPTS: "1",
        CLOUDSDK_COMPONENT_MANAGER_DISABLE_UPDATE_CHECK: "1",
      },
    });
    if (result.error || result.status !== 0) throw gcloudFailure(result);

    await chmod(signatureFile, 0o600);
    await assertSecureTemporaryPath(signatureFile, "file", 0o600);
    const encoded = (await readFile(signatureFile, "utf8")).trim();
    assert(/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded), "KMS signature file is not canonical base64 text");
    const signature = Buffer.from(encoded, "base64");
    assert.equal(signature.toString("base64"), encoded, "KMS signature base64 is noncanonical");
    return signature;
  } finally {
    await removeSecureTemporaryDirectory(temporary);
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  assert(
    /^[0-9a-f]{64}$/u.test(options.expectedMessageSha256),
    "expected message SHA-256 must be 64 lowercase hexadecimal characters",
  );
  const authority = resolveAllowedAuthority(options.authority);
  assert.equal(
    options.kmsKeyVersion,
    authority.kmsKeyVersion,
    "KMS key version does not match the selected fixed Devnet ceremony authority",
  );
  const kms = parseKmsKeyVersion(options.kmsKeyVersion);
  const secureMessageFile = await requireSecureRegularFile(options.message, "raw Solana message");
  const messageBytes = await readFile(secureMessageFile);
  const messageSha256 = sha256Hex(messageBytes);
  assert.equal(messageSha256, options.expectedMessageSha256, "raw Solana message SHA-256 changed");
  const requiredSignerIndex = decodeAndBindSolanaMessage(messageBytes, authority.publicKey);
  const publicKey = await loadAndBindPublicKey(options.publicKeyPem, authority.publicKey);

  const signature = await signWithGcloud({ kms, messageBytes });
  assert.equal(signature.length, 64, "KMS Ed25519 signature is not exactly 64 bytes");
  assert(
    verifySignature(null, messageBytes, publicKey, signature),
    "KMS signature does not verify over the exact raw Solana message",
  );

  process.stdout.write(`${JSON.stringify({
    schema: "ameba-gcp-kms-ed25519-signature-v1",
    authorityRole: authority.role,
    authority: authority.publicKey.toBase58(),
    kmsKeyVersion: options.kmsKeyVersion,
    messageBytes: messageBytes.length,
    messageSha256,
    requiredSignerIndex,
    signatureBase64: signature.toString("base64"),
  })}\n`);
}

const previousUmask = process.umask(0o077);
try {
  await main();
} finally {
  process.umask(previousUmask);
}
