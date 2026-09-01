import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
  readFile,
  realpath,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.umask(0o077);

const PROVIDER_ID_PREFIX = "ameba-governance-v2-local-payer-kms-authority-v1";
const PAYER_ADDRESS = "G2f6Fv477ZyFbmRFtVr21jf9VufXpiRCxf1e91J6SxxT";
const FEE_PAYER_ENVIRONMENT = "AMEBA_GOVERNANCE_V2_FEE_PAYER_KEYPAIR";
const SIGNER_TOOL_ENVIRONMENT = "AMEBA_GOVERNANCE_V2_KMS_SIGNER_TOOL";
const SIGNER_TOOL_SHA256 = "f9abf1e296a76ed74d51c236726701ef88bab466dd7cb236da889c3c502d3393";
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ED25519_PKCS8_SEED_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const ED25519_SPKI_PUBLIC_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const MAX_MESSAGE_BYTES = 1_232;

const KMS_AUTHORITIES = Object.freeze([
  Object.freeze({
    role: "legacy-target-authority",
    address: "D5jhTM3kYHdKixrc52Kn657gBHytQLhQqsTmJBcNFVdq",
    pemEnvironment: "AMEBA_LEGACY_AUTHORITY_KMS_PUBLIC_PEM",
    pemSha256: "204fe6ff6b7ae6ad251f8bc55ad5a7980f5cc2d8b91ad1d5ea9889c9afd7ae71",
    kmsKeyVersion: "projects/amoeba-hm0q2k/locations/global/keyRings/ameba-spread-devnet/cryptoKeys/upgrade-authority-v1/cryptoKeyVersions/1",
  }),
  Object.freeze({
    role: "seat-0",
    address: "pSutXCyMTkwvzG1kpiHXULkVKyzz8NPSNgnjLgwNcTu",
    pemEnvironment: "AMEBA_SEAT_0_KMS_PUBLIC_PEM",
    pemSha256: "ba4ffad38aec40bedc6ccebaf7621b0a0bb2d3ab161544cac4215e7358c145a5",
    kmsKeyVersion: "projects/amoeba-hm0q2k/locations/global/keyRings/ameba-spread-devnet/cryptoKeys/governance-seat-1-v1/cryptoKeyVersions/1",
  }),
  Object.freeze({
    role: "seat-1",
    address: "4vrxWeSfCoJA8KvzCcWGgG4C5S4gPYrLaRWysycJeVpz",
    pemEnvironment: "AMEBA_SEAT_1_KMS_PUBLIC_PEM",
    pemSha256: "09fd51ed6d6b17830c95da25a25b2b29f1ac3b110e4792325e3c5cbaa59d9909",
    kmsKeyVersion: "projects/amoeba-hm0q2k/locations/global/keyRings/ameba-spread-devnet/cryptoKeys/governance-seat-2-v1/cryptoKeyVersions/1",
  }),
  Object.freeze({
    role: "seat-2",
    address: "DgMGtSjUg1wXPZuPBT6HqGN3qRLVBJCqYrv31XtcwcBR",
    pemEnvironment: "AMEBA_SEAT_2_KMS_PUBLIC_PEM",
    pemSha256: "63e7ba0ce82d76b7b372a225c1a93436c4dbf00694eb2c28e5671faf090e7ac7",
    kmsKeyVersion: "projects/amoeba-hm0q2k/locations/global/keyRings/ameba-spread-devnet/cryptoKeys/governance-seat-3-v1/cryptoKeyVersions/1",
  }),
  Object.freeze({
    role: "seat-3",
    address: "4SJyALW3CinnBrFUzHeJL6v5KM12hw2FGLL1wbVTVfn8",
    pemEnvironment: "AMEBA_SEAT_3_KMS_PUBLIC_PEM",
    pemSha256: "80d3f32919e4e09495f56934894b4574535ca08d4e31816617384ca33dc7f799",
    kmsKeyVersion: "projects/amoeba-hm0q2k/locations/global/keyRings/ameba-spread-devnet/cryptoKeys/governance-seat-4-v1/cryptoKeyVersions/1",
  }),
  Object.freeze({
    role: "seat-4",
    address: "Cmd42MrYC7CVyQNGq7GRkTqR3jQ8cBPKzjzDpsc5eNW4",
    pemEnvironment: "AMEBA_SEAT_4_KMS_PUBLIC_PEM",
    pemSha256: "432261d91f3050ae40c309f4debee3df83bef490c7c4dbf7bc9b11828be5cd33",
    kmsKeyVersion: "projects/amoeba-hm0q2k/locations/global/keyRings/ameba-spread-devnet/cryptoKeys/governance-seat-5-v1/cryptoKeyVersions/1",
  }),
]);

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  assert(value, `${name} is required`);
  return value;
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

async function requireSecureFile(input, label, { inside = null, exactMode = false } = {}) {
  assert(typeof input === "string" && path.isAbsolute(input), `${label} path must be absolute`);
  const file = path.resolve(input);
  if (inside !== null) {
    const relative = path.relative(inside, file);
    assert(relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative), `${label} must be inside the ceremony run directory`);
  }
  const status = await lstat(file);
  assert(status.isFile() && !status.isSymbolicLink(), `${label} must be a real regular file`);
  const uid = currentUid();
  if (uid !== undefined) assert.equal(status.uid, uid, `${label} owner changed`);
  if (exactMode) assert.equal(status.mode & 0o777, 0o600, `${label} permissions must be exactly 0600`);
  else assert.equal(status.mode & 0o022, 0, `${label} must not be group/other writable`);
  assert.equal(status.nlink, 1, `${label} must not be hard-linked`);
  assert.equal(await realpath(file), file, `${label} path must not traverse a symbolic link`);
  return file;
}

function encodeBase58(bytes) {
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
  assert(seed instanceof Uint8Array && seed.length === 32, "fee-payer Ed25519 seed is invalid");
  const der = Buffer.alloc(ED25519_PKCS8_SEED_PREFIX.length + seed.length);
  try {
    ED25519_PKCS8_SEED_PREFIX.copy(der, 0);
    Buffer.from(seed).copy(der, ED25519_PKCS8_SEED_PREFIX.length);
    return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  } finally {
    der.fill(0);
  }
}

function rawPublicKey(privateKey) {
  const der = Buffer.from(createPublicKey(privateKey).export({ format: "der", type: "spki" }));
  try {
    assert.equal(der.length, ED25519_SPKI_PUBLIC_PREFIX.length + 32, "fee-payer public-key encoding changed");
    assert(der.subarray(0, ED25519_SPKI_PUBLIC_PREFIX.length).equals(ED25519_SPKI_PUBLIC_PREFIX), "fee-payer public-key prefix changed");
    return Buffer.from(der.subarray(ED25519_SPKI_PUBLIC_PREFIX.length));
  } finally {
    der.fill(0);
  }
}

async function loadFeePayer(runDir) {
  const file = await requireSecureFile(
    requiredEnvironment(FEE_PAYER_ENVIRONMENT),
    "governance V2 fee-payer keypair",
    { inside: runDir, exactMode: true },
  );
  const encoded = await readFile(file);
  assert(encoded.length > 0 && encoded.length <= 1_024, "fee-payer keypair file is outside the fixed size bound");
  let values;
  try {
    values = JSON.parse(encoded.toString("utf8"));
  } finally {
    encoded.fill(0);
  }
  assert(Array.isArray(values) && values.length === 64, "fee-payer keypair is malformed");
  assert(values.every((value) => Number.isInteger(value) && value >= 0 && value <= 255), "fee-payer keypair bytes are malformed");
  const secretKey = Uint8Array.from(values);
  values.fill(0);
  const privateKey = privateKeyFromSeed(secretKey.subarray(0, 32));
  const derived = rawPublicKey(privateKey);
  assert(derived.equals(Buffer.from(secretKey.subarray(32))), "fee-payer public half does not match its seed");
  assert.equal(encodeBase58(derived), PAYER_ADDRESS, "local keypair is not the fixed ceremony fee payer");
  return { file, secretKey, privateKey, publicKey: createPublicKey(privateKey) };
}

async function loadPublicPem(authority) {
  const file = await requireSecureFile(requiredEnvironment(authority.pemEnvironment), `${authority.role} KMS public PEM`, { exactMode: true });
  const raw = await readFile(file);
  const publicKey = createPublicKey(raw);
  assert.equal(sha256Hex(raw), authority.pemSha256, `${authority.role} public PEM bytes changed`);
  assert.equal(publicKey.asymmetricKeyType, "ed25519", `${authority.role} public PEM is not Ed25519`);
  const jwk = publicKey.export({ format: "jwk" });
  assert.equal(jwk.kty, "OKP", `${authority.role} public PEM key type changed`);
  assert.equal(jwk.crv, "Ed25519", `${authority.role} public PEM curve changed`);
  const publicBytes = Buffer.from(jwk.x, "base64url");
  assert.equal(publicBytes.length, 32, `${authority.role} public key length changed`);
  assert.equal(encodeBase58(publicBytes), authority.address, `${authority.role} public PEM identity changed`);
  return { ...authority, file, sha256: authority.pemSha256, publicKey };
}

async function loadSignerTool() {
  const file = await requireSecureFile(requiredEnvironment(SIGNER_TOOL_ENVIRONMENT), "pinned GCP KMS signer tool");
  const sha256 = sha256Hex(await readFile(file));
  assert.equal(sha256, SIGNER_TOOL_SHA256, "GCP KMS signer tool bytes changed");
  return { file, sha256 };
}

function transactionSurface(transaction) {
  assert(transaction?.message && typeof transaction.message.serialize === "function", "governance V2 provider accepts only a versioned transaction");
  const required = transaction.message.header?.numRequiredSignatures;
  assert(Number.isSafeInteger(required) && required > 0, "versioned transaction signer count is invalid");
  assert(Array.isArray(transaction.signatures) && transaction.signatures.length === required, "versioned transaction signature count changed");
  const signerKeys = transaction.message.staticAccountKeys.slice(0, required);
  assert.equal(signerKeys.length, required, "versioned transaction signer keys are truncated");
  return {
    messageBytes: Buffer.from(transaction.message.serialize()),
    signerAddresses: signerKeys.map((key) => key.toBase58()),
  };
}

function assertStageSigner(stage, authority) {
  if (authority.role === "legacy-target-authority") {
    assert(
      [
        "proposal-execute",
        "former-authority-negative",
        "former-authority-proof-buffer-close",
      ].includes(stage),
      "legacy target authority may sign only handoff execution or the exact former-authority proof/close boundary",
    );
    return;
  }
  const seatIndex = Number(authority.role.slice("seat-".length));
  if (stage === "proposal-create") {
    assert.equal(seatIndex, 0, "only seat 0 may sign proposal creation in this adapter");
    return;
  }
  assert.equal(stage, `proposal-approve-${seatIndex}`, `${authority.role} may sign only its exact approval stage`);
}

function assertExpectedSignerSet(expectedSignerPubkeys, signerAddresses, kmsByAddress, stage) {
  assert(Array.isArray(expectedSignerPubkeys) && expectedSignerPubkeys.length >= 1 && expectedSignerPubkeys.length <= 2, "governance V2 signer count is outside the closed surface");
  assert.deepEqual(signerAddresses, expectedSignerPubkeys, "transaction signer identity or order changed");
  assert.equal(expectedSignerPubkeys[0], PAYER_ADDRESS, "fixed local fee payer must be signer 0");
  assert.equal(new Set(expectedSignerPubkeys).size, expectedSignerPubkeys.length, "governance V2 signer is duplicated");
  if (expectedSignerPubkeys.length === 2) {
    const authority = kmsByAddress.get(expectedSignerPubkeys[1]);
    assert(authority, "second signer is not a fixed governance KMS authority");
    assertStageSigner(stage, authority);
  } else {
    assert(
      stage === "observation-begin"
        || stage === "observation-finalize"
        || /^observation-(?:raw|artifact)-[0-9]{3}$/u.test(stage)
        || stage === "proposal-queue"
        || stage === "proposal-execute",
      "payer-only stage is outside the closed governance V2 surface",
    );
  }
}

async function secureMessageFile(runDir, stage, messageBytes) {
  const safeStage = stage.replace(/[^a-z0-9-]/gu, "-");
  const file = path.join(runDir, `.governance-v2-kms-message-${safeStage}-${sha256Hex(messageBytes).slice(0, 16)}.bin`);
  await writeFile(file, messageBytes, { flag: "wx", mode: 0o600 });
  await chmod(file, 0o600);
  await requireSecureFile(file, "temporary KMS message", { inside: runDir, exactMode: true });
  return file;
}

function assertExactKeys(value, keys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} keys changed`);
}

async function signKms({ transaction, messageBytes, messageSha256, stage, signerIndex, authority, signerTool, runDir }) {
  const messageFile = await secureMessageFile(runDir, stage, messageBytes);
  try {
    const result = spawnSync(process.execPath, [
      signerTool.file,
      "--authority", authority.role,
      "--kms-key-version", authority.kmsKeyVersion,
      "--public-key-pem", authority.file,
      "--message", messageFile,
      "--expected-message-sha256", messageSha256,
    ], {
      shell: false,
      windowsHide: true,
      encoding: "utf8",
      maxBuffer: 64 * 1024,
      timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error || result.status !== 0) {
      throw new Error(`KMS signer failed for ${authority.role} (status=${result.status ?? "none"}, stdoutSha256=${sha256Hex(Buffer.from(result.stdout ?? "", "utf8"))}, stderrSha256=${sha256Hex(Buffer.from(result.stderr ?? "", "utf8"))})`);
    }
    const signed = JSON.parse(result.stdout);
    assertExactKeys(signed, [
      "schema", "authorityRole", "authority", "kmsKeyVersion", "messageBytes",
      "messageSha256", "requiredSignerIndex", "signatureBase64",
    ], `${authority.role} KMS result`);
    assert.equal(signed.schema, "ameba-gcp-kms-ed25519-signature-v1");
    assert.equal(signed.authorityRole, authority.role);
    assert.equal(signed.authority, authority.address);
    assert.equal(signed.kmsKeyVersion, authority.kmsKeyVersion);
    assert.equal(signed.messageBytes, messageBytes.length);
    assert.equal(signed.messageSha256, messageSha256);
    assert.equal(signed.requiredSignerIndex, signerIndex, `${authority.role} signer index changed`);
    const signature = Buffer.from(signed.signatureBase64, "base64");
    assert.equal(signature.length, 64, `${authority.role} KMS signature length changed`);
    assert.equal(signature.toString("base64"), signed.signatureBase64, `${authority.role} KMS signature is noncanonical base64`);
    assert(verifyDetached(null, messageBytes, authority.publicKey, signature), `${authority.role} KMS signature failed provider verification`);
    transaction.signatures[signerIndex] = signature;
  } finally {
    await unlink(messageFile).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

export async function createSignerProvider({ runDir }) {
  const secureRunDir = await requireSecureDirectory(runDir, "ceremony run directory");
  await requireSecureFile(path.resolve(fileURLToPath(import.meta.url)), "governance V2 signer-provider module", { inside: secureRunDir, exactMode: true });
  let feePayer;
  let signerTool;
  let kmsAuthorities;
  try {
    feePayer = await loadFeePayer(secureRunDir);
    signerTool = await loadSignerTool();
    kmsAuthorities = await Promise.all(KMS_AUTHORITIES.map(loadPublicPem));
  } catch (error) {
    feePayer?.secretKey.fill(0);
    throw error;
  }
  const kmsByAddress = new Map(kmsAuthorities.map((entry) => [entry.address, entry]));
  const identityCommitment = sha256Hex(Buffer.from(JSON.stringify({
    feePayer: PAYER_ADDRESS,
    kms: kmsAuthorities.map(({ role, address, sha256 }) => ({ role, address, sha256 })),
    signerToolSha256: signerTool.sha256,
  }), "utf8"));
  let consumed = false;
  return {
    id: `${PROVIDER_ID_PREFIX}/${identityCommitment}`,
    kind: "kms",
    async signTransaction({ expectedSignerPubkeys, messageSha256, operationId, stage, transaction }) {
      assert.equal(consumed, false, "governance V2 signer provider is single-use");
      consumed = true;
      try {
        assert(/^[0-9a-f]{64}$/u.test(operationId), "governance V2 signer operation ID is invalid");
        assert(/^[a-z0-9][a-z0-9-]*$/u.test(stage), "governance V2 signer stage is invalid");
        assert(/^[0-9a-f]{64}$/u.test(messageSha256), "governance V2 message commitment is invalid");
        const before = transactionSurface(transaction);
        assert(before.messageBytes.length > 0 && before.messageBytes.length <= MAX_MESSAGE_BYTES, "governance V2 message length is outside bounds");
        assert.equal(sha256Hex(before.messageBytes), messageSha256, "governance V2 message commitment changed");
        assertExpectedSignerSet(expectedSignerPubkeys, before.signerAddresses, kmsByAddress, stage);
        const payerSignature = signDetached(null, before.messageBytes, feePayer.privateKey);
        try {
          assert.equal(payerSignature.length, 64, "fee-payer signature length changed");
          assert(verifyDetached(null, before.messageBytes, feePayer.publicKey, payerSignature), "fee-payer signature failed local verification");
          transaction.signatures[0] = Uint8Array.from(payerSignature);
        } finally {
          payerSignature.fill(0);
        }
        if (expectedSignerPubkeys.length === 2) {
          await signKms({
            transaction,
            messageBytes: before.messageBytes,
            messageSha256,
            stage,
            signerIndex: 1,
            authority: kmsByAddress.get(expectedSignerPubkeys[1]),
            signerTool,
            runDir: secureRunDir,
          });
        }
        const after = transactionSurface(transaction);
        assert(after.messageBytes.equals(before.messageBytes), "signer provider changed the exact transaction message");
        assert.deepEqual(after.signerAddresses, expectedSignerPubkeys, "signer provider changed signer identity or order");
        return transaction;
      } finally {
        feePayer.secretKey.fill(0);
      }
    },
  };
}

async function selfTest() {
  assert.equal(new Set(KMS_AUTHORITIES.map(({ role }) => role)).size, KMS_AUTHORITIES.length);
  assert.equal(new Set(KMS_AUTHORITIES.map(({ address }) => address)).size, KMS_AUTHORITIES.length);
  assert.equal(new Set(KMS_AUTHORITIES.map(({ pemEnvironment }) => pemEnvironment)).size, KMS_AUTHORITIES.length);
  const byAddress = new Map(KMS_AUTHORITIES.map((entry) => [entry.address, entry]));
  assertExpectedSignerSet([PAYER_ADDRESS], [PAYER_ADDRESS], byAddress, "proposal-queue");
  assertExpectedSignerSet([PAYER_ADDRESS, KMS_AUTHORITIES[0].address], [PAYER_ADDRESS, KMS_AUTHORITIES[0].address], byAddress, "proposal-execute");
  assertExpectedSignerSet([PAYER_ADDRESS, KMS_AUTHORITIES[0].address], [PAYER_ADDRESS, KMS_AUTHORITIES[0].address], byAddress, "former-authority-negative");
  assertExpectedSignerSet([PAYER_ADDRESS, KMS_AUTHORITIES[0].address], [PAYER_ADDRESS, KMS_AUTHORITIES[0].address], byAddress, "former-authority-proof-buffer-close");
  for (let index = 1; index <= 3; index += 1) {
    assertExpectedSignerSet(
      [PAYER_ADDRESS, KMS_AUTHORITIES[index].address],
      [PAYER_ADDRESS, KMS_AUTHORITIES[index].address],
      byAddress,
      index === 1 ? "proposal-create" : `proposal-approve-${index - 1}`,
    );
  }
  await assert.rejects(
    async () => assertExpectedSignerSet([PAYER_ADDRESS, KMS_AUTHORITIES[2].address], [PAYER_ADDRESS, KMS_AUTHORITIES[2].address], byAddress, "proposal-approve-0"),
    undefined,
    "provider self-test accepted a seat at another seat's approval stage",
  );
  return {
    schema: "ameba-governance-v2-kms-signer-provider-self-test-v1",
    payer: PAYER_ADDRESS,
    signerToolSha256: SIGNER_TOOL_SHA256,
    kmsAuthorities: KMS_AUTHORITIES.map(({ role, address, pemEnvironment }) => ({ role, address, pemEnvironment })),
    localPrivateAuthorityAllowed: false,
    rawSignatureInputAllowed: false,
    rpcUsed: false,
    signingUsed: false,
  };
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  assert.equal(process.argv.length, 3, "usage: devnet-governance-v2-kms-signer-provider.mjs self-test");
  assert.equal(process.argv[2], "self-test", "usage: devnet-governance-v2-kms-signer-provider.mjs self-test");
  process.stdout.write(`${JSON.stringify(await selfTest())}\n`);
}
