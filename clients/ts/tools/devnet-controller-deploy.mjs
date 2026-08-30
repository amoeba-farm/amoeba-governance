import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, open, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { Connection, PublicKey } from "@solana/web3.js";

import {
  loadDevnetRpcConfiguration,
  requireSecureDirectory,
  requireSecureRegularFile,
} from "./secure-rpc-env.mjs";

const EXPECTED_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const EXPECTED_FEE_PAYER = new PublicKey("G2f6Fv477ZyFbmRFtVr21jf9VufXpiRCxf1e91J6SxxT");
const EXPECTED_INITIALIZER = new PublicKey("7wHuwk8DkqCN7vuEWzLhfLDQeiUUKKYfocjjDL5mxQvZ");
const EXPECTED_CONTROLLER_PROGRAM = new PublicKey("CzyGUEVtLg2FTWdZmQ6KZCydw73KutLtE6c5PJgnxQqa");
const EXPECTED_CONTROLLER_PROGRAMDATA = new PublicKey("H9zckD4ukjmKQL6tF5G9uZWixKomxeXxW2CPA3MkgPN9");
const EXPECTED_DEPLOY_BUFFER = new PublicKey("9DAowZpMbWKNAvjz81HXKQqUJbaTiQ9RZmgu5xgddogM");
const SOLANA = "/home/space/.local/share/solana/install/active_release/bin/solana";
const EXPECTED_ARTIFACT_SHA256 = "0c107bce1ec34d3badf72b69161f0cae0b82a7b85ea714770f3876c08e6c1b18";
const EXPECTED_ARTIFACT_BYTES = 1_114_592;
const FAILED_V5_OPERATION_ID = "0db0bc8cdf9c3fbe5dcbcc76664194c3e6614849fbf1b86d8bf30772c2d99408";
const FAILED_V5_STDOUT_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const FAILED_V5_STDERR_SHA256 = "d7a2f4702f16fe0aa91d837713d3d67ad40623535a9220c53c1bf59c5fe7bcdd";
const RECOVERY_BUFFER_RAW_SHA256 = "ff9049899f0f15fdd02f70279a1b23b42bd045b23e69efb822dc08eea44af78e";
const RECOVERY_BUFFER_PAYLOAD_SHA256 = "120cea59632a3ef55abce092698f658aa4bc10e1995441593050b766c2554bf8";
const RECOVERY_BUFFER_LAMPORTS = 7_758_764_400;
const FAILED_V6_OPERATION_ID = "eb52e159fbb35648921fd09ac807fab1f29bce79938a5b79f7d50ec9475222e5";
const RESUME_V7_BUFFER_RAW_SHA256 = "9fcfb538655b5f7a5224fae24bc730e20dcb69c69dd40bd5df4a03528f498cb0";
const RESUME_V7_BUFFER_PAYLOAD_SHA256 = "3d15e358e6aaa2372de167832698bcf90b6434aadec84ecd3c99d039da738ab8";
const RESUME_V7_EXACT_WRITE_COUNT = 32;
const RESUME_V7_EXACT_WRITTEN_BYTES = 29_312;
const RESUME_V7_WRITE_MANIFEST_SHA256 = "877887efc25d877c0c55c6012e49da5d02d6ff46a3509f2251fbb831973af254";

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing required environment ${name}`);
  return value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sanitizedChildEnvironment() {
  return {
    HOME: "/home/space",
    LANG: process.env.LANG ?? "C.UTF-8",
    PATH: "/home/space/.cargo/bin:/home/space/.local/share/solana/install/active_release/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  };
}

async function solanaAddress(file, expected, label) {
  const secureFile = await requireSecureRegularFile(file, `${label} keypair`);
  const result = spawnSync(SOLANA, ["address", "--keypair", secureFile], {
    encoding: "utf8",
    env: sanitizedChildEnvironment(),
  });
  assert.equal(result.status, 0, `${label} public-key derivation failed`);
  const address = new PublicKey(result.stdout.trim());
  if (expected) assert(address.equals(expected), `${label} identity changed`);
  return { address, file: secureFile };
}

async function solanaAddressFromHandle(handle, expected, label) {
  const status = await handle.stat();
  assert(status.isFile(), `${label} descriptor must reference a regular file`);
  if (typeof process.getuid === "function") {
    assert.equal(status.uid, process.getuid(), `${label} descriptor must be owned by the current user`);
  }
  assert.equal(status.mode & 0o077, 0, `${label} descriptor must not grant group or other permissions`);
  const result = spawnSync(SOLANA, ["address", "--keypair", "/proc/self/fd/3"], {
    encoding: "utf8",
    env: sanitizedChildEnvironment(),
    stdio: ["ignore", "pipe", "pipe", handle.fd],
  });
  assert.equal(result.status, 0, `${label} descriptor public-key derivation failed`);
  const address = new PublicKey(result.stdout.trim());
  assert(address.equals(expected), `${label} descriptor identity changed`);
}

async function inputs() {
  const { rpcSelection, stateRpcOrigin, stateRpcUrl: rpcUrl } = await loadDevnetRpcConfiguration();
  const runDir = await requireSecureDirectory(requiredEnvironment("AMEBA_CEREMONY_RUN_DIR"), "ceremony run directory");
  const artifactPath = path.resolve(requiredEnvironment("AMEBA_CONTROLLER_ARTIFACT"));
  const programKeypairPath = path.resolve(requiredEnvironment("AMEBA_CONTROLLER_PROGRAM_KEYPAIR"));
  const bufferKeypairPath = path.resolve(requiredEnvironment("AMEBA_CONTROLLER_DEPLOY_BUFFER"));
  const feePayerPath = path.resolve(requiredEnvironment("AMEBA_CEREMONY_FEE_PAYER"));
  const initializerPath = path.resolve(requiredEnvironment("AMEBA_CONTROLLER_INITIALIZER"));
  const artifact = await readFile(artifactPath);
  assert.equal(artifact.length, EXPECTED_ARTIFACT_BYTES, "controller artifact length changed");
  assert.equal(sha256(artifact), EXPECTED_ARTIFACT_SHA256, "controller artifact hash changed");
  const programKeypair = await solanaAddress(programKeypairPath, EXPECTED_CONTROLLER_PROGRAM, "controller program");
  const bufferKeypair = await solanaAddress(bufferKeypairPath, EXPECTED_DEPLOY_BUFFER, "controller deploy buffer");
  const feePayer = await solanaAddress(feePayerPath, EXPECTED_FEE_PAYER, "fee payer");
  const initializer = await solanaAddress(initializerPath, EXPECTED_INITIALIZER, "controller initializer");
  const controllerProgram = programKeypair.address;
  const [controllerProgramdata] = PublicKey.findProgramAddressSync(
    [controllerProgram.toBuffer()],
    LOADER,
  );
  assert(controllerProgramdata.equals(EXPECTED_CONTROLLER_PROGRAMDATA), "controller ProgramData identity changed");
  const connection = new Connection(rpcUrl, {
    commitment: "finalized",
    confirmTransactionInitialTimeout: 60_000,
    disableRetryOnRateLimit: true,
  });
  assert.equal(await connection.getGenesisHash(), EXPECTED_GENESIS, "state RPC genesis changed");
  return {
    artifact,
    artifactPath,
    buffer: bufferKeypair.address,
    bufferKeypairPath: bufferKeypair.file,
    connection,
    controllerProgram,
    controllerProgramdata,
    feePayerPath: feePayer.file,
    initializerPath: initializer.file,
    programKeypairPath: programKeypair.file,
    rpcUrl,
    rpcSelection,
    stateRpcOrigin,
    runDir,
  };
}

async function assertAbsent(connection, controllerProgram, controllerProgramdata, buffer) {
  const response = await connection.getMultipleAccountsInfoAndContext(
    [controllerProgram, controllerProgramdata, buffer],
    { commitment: "finalized" },
  );
  assert.equal(response.value[0], null, "controller program address is already occupied");
  assert.equal(response.value[1], null, "controller ProgramData address is already occupied");
  assert.equal(response.value[2], null, "controller deploy buffer address is already occupied");
  return response.context.slot;
}

async function assertRecoverableBuffer(connection, controllerProgram, controllerProgramdata, buffer, artifactLength, expectedRawSha256, expectedPayloadSha256, label) {
  const response = await connection.getMultipleAccountsInfoAndContext(
    [controllerProgram, controllerProgramdata, buffer],
    { commitment: "finalized" },
  );
  assert.equal(response.value[0], null, `controller program address became occupied during ${label}`);
  assert.equal(response.value[1], null, `controller ProgramData address became occupied during ${label}`);
  const account = response.value[2];
  assert(account, `the exact ${label} deploy buffer is absent`);
  assert(account.owner.equals(LOADER) && !account.executable, "recovery buffer Loader state changed");
  assert.equal(account.data.length, 37 + artifactLength, "recovery buffer length changed");
  assert.equal(account.data.readUInt32LE(0), 1, "recovery buffer Loader tag changed");
  assert.equal(account.data[4], 1, "recovery buffer authority option changed");
  assert(new PublicKey(account.data.subarray(5, 37)).equals(EXPECTED_INITIALIZER), "recovery buffer authority changed");
  assert.equal(account.lamports, RECOVERY_BUFFER_LAMPORTS, "recovery buffer lamports changed");
  const rawSha256 = sha256(account.data);
  const payloadSha256 = sha256(account.data.subarray(37));
  assert.equal(rawSha256, expectedRawSha256, `${label} buffer raw bytes changed`);
  assert.equal(payloadSha256, expectedPayloadSha256, `${label} buffer payload bytes changed`);
  return {
    observationSlot: response.context.slot,
    bufferLamports: account.lamports,
    bufferRawBytes: account.data.length,
    bufferRawSha256: rawSha256,
    bufferPayloadBytes: account.data.length - 37,
    bufferPayloadSha256: payloadSha256,
    bufferAuthority: EXPECTED_INITIALIZER.toBase58(),
  };
}

function assertRecoverableV5Buffer(connection, controllerProgram, controllerProgramdata, buffer, artifactLength) {
  return assertRecoverableBuffer(
    connection, controllerProgram, controllerProgramdata, buffer, artifactLength,
    RECOVERY_BUFFER_RAW_SHA256, RECOVERY_BUFFER_PAYLOAD_SHA256, "v5 recovery",
  );
}

function assertRecoverableV6Buffer(connection, controllerProgram, controllerProgramdata, buffer, artifactLength) {
  return assertRecoverableBuffer(
    connection, controllerProgram, controllerProgramdata, buffer, artifactLength,
    RESUME_V7_BUFFER_RAW_SHA256, RESUME_V7_BUFFER_PAYLOAD_SHA256, "v6 resume",
  );
}

function operationId(material) {
  return sha256(Buffer.from(JSON.stringify(material), "utf8"));
}

async function writeExclusiveJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await chmod(file, 0o600);
}

function rpcProviderOriginSha256(origin) {
  return sha256(Buffer.concat([
    Buffer.from("AMOEBA_DEVNET_RPC_PROVIDER_ORIGIN_V1", "ascii"),
    Buffer.from(origin, "utf8"),
  ]));
}

async function fundingSnapshot(connection, artifactLength, bufferAlreadyFunded = false) {
  const [feePayerBalanceLamports, programRentLamports, programdataRentLamports, bufferRentLamports] = await Promise.all([
    connection.getBalance(EXPECTED_FEE_PAYER, "finalized"),
    connection.getMinimumBalanceForRentExemption(36, "finalized"),
    connection.getMinimumBalanceForRentExemption(45 + artifactLength, "finalized"),
    connection.getMinimumBalanceForRentExemption(37 + artifactLength, "finalized"),
  ]);
  const peakRequiredLamports = programRentLamports + programdataRentLamports
    + (bufferAlreadyFunded ? 0 : bufferRentLamports) + 500_000_000;
  assert(feePayerBalanceLamports >= peakRequiredLamports, "fee payer cannot cover peak deploy rent plus 0.5 SOL margin");
  return { feePayerBalanceLamports, programRentLamports, programdataRentLamports, bufferRentLamports, peakRequiredLamports };
}

const PLAN_KEYS = [
  "artifactBytes", "artifactSha256", "buffer", "bufferRentLamports", "commitment",
  "controllerProgram", "controllerProgramdata", "exactProgramdataCapacity", "feePayer",
  "feePayerBalanceLamports", "genesisHash", "initialUpgradeAuthority", "loader", "mainnetAllowed",
  "observedSlot", "operationId", "peakRequiredLamports", "planValidUntilSlot", "programRentLamports",
  "programdataRentLamports", "rpcProviderOriginSha256", "schema",
].sort();

const RECOVERY_PLAN_KEYS = [
  ...PLAN_KEYS.filter((key) => key !== "schema"),
  "bufferAlreadyFunded", "recoveryBufferAuthority", "recoveryBufferLamports",
  "recoveryBufferPayloadBytes", "recoveryBufferPayloadSha256", "recoveryBufferRawBytes",
  "recoveryBufferRawSha256", "recoveryFromOperationId", "recoveryPlanV5Sha256",
  "recoveryStderrSha256", "recoveryStdoutSha256", "schema",
].sort();

const RESUME_V7_PLAN_KEYS = [
  ...RECOVERY_PLAN_KEYS,
  "recoveryPlanV6Sha256", "resumeExactWriteCount", "resumeExactWrittenBytes",
  "resumeWriteManifestSha256", "rpcSelection",
].sort();

function assertExactKeys(value, keys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), keys, `${label} keys changed`);
}

async function planDeploy() {
  const value = await inputs();
  const observedSlot = await assertAbsent(
    value.connection,
    value.controllerProgram,
    value.controllerProgramdata,
    value.buffer,
  );
  const funding = await fundingSnapshot(value.connection, value.artifact.length);
  const material = {
    schema: "ameba-governance-devnet-controller-deploy-plan-v5",
    genesisHash: EXPECTED_GENESIS,
    observedSlot,
    planValidUntilSlot: observedSlot + 1_000,
    controllerProgram: value.controllerProgram.toBase58(),
    controllerProgramdata: value.controllerProgramdata.toBase58(),
    buffer: value.buffer.toBase58(),
    artifactBytes: value.artifact.length,
    artifactSha256: sha256(value.artifact),
    exactProgramdataCapacity: value.artifact.length,
    feePayer: EXPECTED_FEE_PAYER.toBase58(),
    initialUpgradeAuthority: EXPECTED_INITIALIZER.toBase58(),
    ...funding,
    loader: LOADER.toBase58(),
    commitment: "finalized",
    rpcProviderOriginSha256: rpcProviderOriginSha256(value.stateRpcOrigin),
    mainnetAllowed: false,
  };
  const plan = { ...material, operationId: operationId(material) };
  assertExactKeys(plan, PLAN_KEYS, "controller deploy plan");
  await writeExclusiveJson(path.join(value.runDir, "controller-deploy-plan-v5.json"), plan);
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

async function planRecoveryDeploy() {
  const value = await inputs();
  const recovery = await assertRecoverableV5Buffer(
    value.connection,
    value.controllerProgram,
    value.controllerProgramdata,
    value.buffer,
    value.artifact.length,
  );
  const priorPlanBytes = await readFile(path.join(value.runDir, "controller-deploy-plan-v5.json"));
  const priorPlan = JSON.parse(priorPlanBytes.toString("utf8"));
  assertExactKeys(priorPlan, PLAN_KEYS, "failed v5 deploy plan");
  const { operationId: priorOperationId, ...priorMaterial } = priorPlan;
  assert.equal(operationId(priorMaterial), priorOperationId, "failed v5 deploy plan operation ID changed");
  assert.equal(priorOperationId, FAILED_V5_OPERATION_ID, "unexpected failed v5 operation");
  const funding = await fundingSnapshot(value.connection, value.artifact.length, true);
  const material = {
    schema: "ameba-governance-devnet-controller-deploy-recovery-plan-v6",
    genesisHash: EXPECTED_GENESIS,
    observedSlot: recovery.observationSlot,
    planValidUntilSlot: recovery.observationSlot + 1_000,
    controllerProgram: value.controllerProgram.toBase58(),
    controllerProgramdata: value.controllerProgramdata.toBase58(),
    buffer: value.buffer.toBase58(),
    artifactBytes: value.artifact.length,
    artifactSha256: sha256(value.artifact),
    exactProgramdataCapacity: value.artifact.length,
    feePayer: EXPECTED_FEE_PAYER.toBase58(),
    initialUpgradeAuthority: EXPECTED_INITIALIZER.toBase58(),
    ...funding,
    bufferAlreadyFunded: true,
    recoveryBufferAuthority: recovery.bufferAuthority,
    recoveryBufferLamports: recovery.bufferLamports,
    recoveryBufferRawBytes: recovery.bufferRawBytes,
    recoveryBufferRawSha256: recovery.bufferRawSha256,
    recoveryBufferPayloadBytes: recovery.bufferPayloadBytes,
    recoveryBufferPayloadSha256: recovery.bufferPayloadSha256,
    recoveryFromOperationId: FAILED_V5_OPERATION_ID,
    recoveryPlanV5Sha256: sha256(priorPlanBytes),
    recoveryStdoutSha256: FAILED_V5_STDOUT_SHA256,
    recoveryStderrSha256: FAILED_V5_STDERR_SHA256,
    loader: LOADER.toBase58(),
    commitment: "finalized",
    rpcProviderOriginSha256: rpcProviderOriginSha256(value.stateRpcOrigin),
    mainnetAllowed: false,
  };
  const plan = { ...material, operationId: operationId(material) };
  assertExactKeys(plan, RECOVERY_PLAN_KEYS, "controller deploy recovery plan");
  await writeExclusiveJson(path.join(value.runDir, "controller-deploy-recovery-plan-v6.json"), plan);
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

async function planResumeDeployV7() {
  const value = await inputs();
  assert.equal(value.rpcSelection, "helius-state", "v7 resume requires the dedicated Helius Devnet state RPC");
  const recovery = await assertRecoverableV6Buffer(
    value.connection,
    value.controllerProgram,
    value.controllerProgramdata,
    value.buffer,
    value.artifact.length,
  );
  const priorPlanBytes = await readFile(path.join(value.runDir, "controller-deploy-recovery-plan-v6.json"));
  const priorPlan = JSON.parse(priorPlanBytes.toString("utf8"));
  assertExactKeys(priorPlan, RECOVERY_PLAN_KEYS, "failed v6 deploy recovery plan");
  const { operationId: priorOperationId, ...priorMaterial } = priorPlan;
  assert.equal(operationId(priorMaterial), priorOperationId, "failed v6 deploy recovery plan operation ID changed");
  assert.equal(priorOperationId, FAILED_V6_OPERATION_ID, "unexpected failed v6 operation");
  const funding = await fundingSnapshot(value.connection, value.artifact.length, true);
  const material = {
    schema: "ameba-governance-devnet-controller-deploy-resume-plan-v7",
    genesisHash: EXPECTED_GENESIS,
    observedSlot: recovery.observationSlot,
    planValidUntilSlot: recovery.observationSlot + 2_000,
    controllerProgram: value.controllerProgram.toBase58(),
    controllerProgramdata: value.controllerProgramdata.toBase58(),
    buffer: value.buffer.toBase58(),
    artifactBytes: value.artifact.length,
    artifactSha256: sha256(value.artifact),
    exactProgramdataCapacity: value.artifact.length,
    feePayer: EXPECTED_FEE_PAYER.toBase58(),
    initialUpgradeAuthority: EXPECTED_INITIALIZER.toBase58(),
    ...funding,
    bufferAlreadyFunded: true,
    recoveryBufferAuthority: recovery.bufferAuthority,
    recoveryBufferLamports: recovery.bufferLamports,
    recoveryBufferRawBytes: recovery.bufferRawBytes,
    recoveryBufferRawSha256: recovery.bufferRawSha256,
    recoveryBufferPayloadBytes: recovery.bufferPayloadBytes,
    recoveryBufferPayloadSha256: recovery.bufferPayloadSha256,
    recoveryFromOperationId: FAILED_V6_OPERATION_ID,
    recoveryPlanV5Sha256: priorPlan.recoveryPlanV5Sha256,
    recoveryPlanV6Sha256: sha256(priorPlanBytes),
    recoveryStdoutSha256: FAILED_V5_STDOUT_SHA256,
    recoveryStderrSha256: FAILED_V5_STDERR_SHA256,
    resumeExactWriteCount: RESUME_V7_EXACT_WRITE_COUNT,
    resumeExactWrittenBytes: RESUME_V7_EXACT_WRITTEN_BYTES,
    resumeWriteManifestSha256: RESUME_V7_WRITE_MANIFEST_SHA256,
    loader: LOADER.toBase58(),
    commitment: "finalized",
    rpcSelection: value.rpcSelection,
    rpcProviderOriginSha256: rpcProviderOriginSha256(value.stateRpcOrigin),
    mainnetAllowed: false,
  };
  const plan = { ...material, operationId: operationId(material) };
  assertExactKeys(plan, RESUME_V7_PLAN_KEYS, "controller deploy v7 resume plan");
  await writeExclusiveJson(path.join(value.runDir, "controller-deploy-resume-plan-v7.json"), plan);
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

function renderSolanaConfig(rpcUrl, feePayerDescriptorPath) {
  assert(!rpcUrl.includes("\n") && !rpcUrl.includes("\r") && !rpcUrl.includes('"'), "RPC URL is not YAML-safe");
  assert(!feePayerDescriptorPath.includes("\n") && !feePayerDescriptorPath.includes("\r"), "fee payer descriptor path is not YAML-safe");
  return Buffer.from([
    "---",
    `json_rpc_url: "${rpcUrl}"`,
    'websocket_url: ""',
    `keypair_path: ${JSON.stringify(feePayerDescriptorPath)}`,
    "address_labels: {}",
    "commitment: finalized",
    "",
  ].join("\n"), "utf8");
}

async function anonymousVerifiedFile(runDir, name, bytes) {
  const file = path.join(runDir, name);
  const writer = await open(file, "wx", 0o600);
  let reader;
  try {
    await writer.writeFile(bytes);
    await writer.sync();
    const status = await writer.stat();
    assert(status.isFile(), `${name} staging descriptor is not a regular file`);
    assert.equal(status.size, bytes.length, `${name} staging length changed`);
    if (typeof process.getuid === "function") {
      assert.equal(status.uid, process.getuid(), `${name} staging file must be owned by the current user`);
    }
    assert.equal(status.mode & 0o077, 0, `${name} staging file must not grant group or other permissions`);
    await writer.close();
    reader = await open(file, "r");
    const readerStatus = await reader.stat();
    assert.equal(readerStatus.size, bytes.length, `${name} reader length changed`);
    await unlink(file);
    return reader;
  } catch (error) {
    try { await writer.close(); } catch { /* already closed */ }
    if (reader) await reader.close();
    try { await unlink(file); } catch { /* best-effort cleanup before rethrow */ }
    throw error;
  }
}

async function openSecureHandle(file, label) {
  await requireSecureRegularFile(file, label);
  const handle = await open(file, "r");
  const status = await handle.stat();
  assert(status.isFile(), `${label} descriptor must reference a regular file`);
  if (typeof process.getuid === "function") {
    assert.equal(status.uid, process.getuid(), `${label} descriptor must be owned by the current user`);
  }
  assert.equal(status.mode & 0o077, 0, `${label} descriptor must not grant group or other permissions`);
  return handle;
}

function spawnWithHandles(args, handles) {
  return spawnSync(SOLANA, args, {
    encoding: "utf8",
    env: sanitizedChildEnvironment(),
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe", ...handles.map((handle) => handle.fd)],
  });
}

function commandFailure(label, result) {
  const stderr = result.stderr ?? "";
  const stdout = result.stdout ?? "";
  throw new Error(`${label} failed (${String(result.status)}); stdoutSha256=${sha256(Buffer.from(stdout, "utf8"))}; stderrSha256=${sha256(Buffer.from(stderr, "utf8"))}`);
}

function assertCliDevnet(configHandle) {
  const result = spawnWithHandles([
    "genesis-hash",
    "--config", "/proc/self/fd/3",
    "--commitment", "finalized",
  ], [configHandle]);
  if (result.status !== 0) commandFailure("Solana CLI Devnet genesis preflight", result);
  assert.equal(result.stdout.trim(), EXPECTED_GENESIS, "Solana CLI is not bound to the exact Devnet genesis");
}

function parseLoaderState(account, expectedProgramdata, expectedAuthority, artifact) {
  assert(account.program, "controller program account is absent after deploy");
  assert(account.programdata, "controller ProgramData account is absent after deploy");
  assert(account.program.owner.equals(LOADER) && account.program.executable, "controller program loader state is invalid");
  assert.equal(account.program.data.readUInt32LE(0), 2, "controller program loader tag is invalid");
  assert(new PublicKey(account.program.data.subarray(4, 36)).equals(expectedProgramdata), "controller ProgramData linkage changed");
  assert(account.programdata.owner.equals(LOADER) && !account.programdata.executable, "controller ProgramData owner/executable state is invalid");
  assert.equal(account.programdata.data.readUInt32LE(0), 3, "controller ProgramData loader tag is invalid");
  assert.equal(account.programdata.data[12], 1, "controller ProgramData authority is absent before initialization");
  assert(new PublicKey(account.programdata.data.subarray(13, 45)).equals(expectedAuthority), "controller ProgramData authority changed");
  const payload = account.programdata.data.subarray(45);
  assert.equal(payload.length, artifact.length, "controller ProgramData capacity is not exact");
  assert(payload.equals(artifact), "deployed controller payload differs from the artifact");
  return {
    deployedSlot: account.programdata.data.readBigUInt64LE(4).toString(),
    rawProgramdataBytes: account.programdata.data.length,
    rawProgramdataSha256: sha256(account.programdata.data),
    payloadBytes: payload.length,
    payloadSha256: sha256(payload),
  };
}

function assertSolanaSignature(value) {
  assert(typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{80,90}$/u.test(value), "deploy signature is not canonical base58");
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = 0n;
  for (const character of value) {
    const index = alphabet.indexOf(character);
    assert(index >= 0, "deploy signature contains a non-base58 character");
    number = number * 58n + BigInt(index);
  }
  const body = [];
  while (number > 0n) {
    body.push(Number(number & 0xffn));
    number >>= 8n;
  }
  const leadingZeroes = value.length - value.replace(/^1+/u, "").length;
  assert.equal(leadingZeroes + body.length, 64, "deploy signature must decode to 64 bytes");
  return value;
}

async function verifyFinalizedTransaction(connection, signature) {
  const [status, landed] = await Promise.all([
    connection.getSignatureStatuses([signature], { searchTransactionHistory: true }),
    connection.getTransaction(signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 }),
  ]);
  const exactStatus = status.value[0];
  assert(exactStatus && exactStatus.err === null && exactStatus.confirmationStatus === "finalized", "deploy signature is not finalized-successful");
  assert(landed && landed.meta && landed.meta.err === null, "finalized deploy transaction is absent or failed");
  assert(landed.transaction.signatures.includes(signature), "finalized deploy transaction does not contain the reported signature");
  return {
    transactionSlot: landed.slot,
    transactionBlockTime: landed.blockTime,
    transactionFeeLamports: landed.meta.fee,
    transactionComputeUnits: landed.meta.computeUnitsConsumed ?? null,
    transactionMessageSha256: sha256(Buffer.from(landed.transaction.message.serialize())),
  };
}

async function executeDeploy() {
  const value = await inputs();
  const planPath = path.join(value.runDir, "controller-deploy-plan-v5.json");
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  assertExactKeys(plan, PLAN_KEYS, "controller deploy plan");
  const { operationId: storedOperationId, ...material } = plan;
  assert.equal(operationId(material), storedOperationId, "deploy plan operation ID changed");
  assert.equal(requiredEnvironment("AMEBA_CEREMONY_ARM"), storedOperationId, "deploy operation is not explicitly armed");
  assert.equal(plan.schema, "ameba-governance-devnet-controller-deploy-plan-v5");
  assert.equal(plan.genesisHash, EXPECTED_GENESIS);
  assert.equal(plan.controllerProgram, value.controllerProgram.toBase58());
  assert.equal(plan.controllerProgramdata, value.controllerProgramdata.toBase58());
  assert.equal(plan.buffer, value.buffer.toBase58());
  assert.equal(plan.artifactSha256, sha256(value.artifact));
  assert.equal(plan.artifactBytes, value.artifact.length);
  assert.equal(plan.exactProgramdataCapacity, value.artifact.length);
  assert.equal(plan.feePayer, EXPECTED_FEE_PAYER.toBase58());
  assert.equal(plan.initialUpgradeAuthority, EXPECTED_INITIALIZER.toBase58());
  assert.equal(plan.loader, LOADER.toBase58());
  assert.equal(plan.commitment, "finalized");
  assert.equal(plan.rpcProviderOriginSha256, rpcProviderOriginSha256(value.stateRpcOrigin));
  assert.equal(plan.mainnetAllowed, false);
  assert(Number.isSafeInteger(plan.observedSlot) && Number.isSafeInteger(plan.planValidUntilSlot) && plan.planValidUntilSlot === plan.observedSlot + 1_000);
  const currentSlot = await assertAbsent(value.connection, value.controllerProgram, value.controllerProgramdata, value.buffer);
  assert(currentSlot <= plan.planValidUntilSlot, "controller deploy plan expired");
  const currentFunding = await fundingSnapshot(value.connection, value.artifact.length);
  for (const [field, expected] of Object.entries(currentFunding)) {
    assert.equal(plan[field], expected, `controller deploy funding field ${field} changed`);
  }

  const handles = [];
  let result;
  try {
    const configHandle = await anonymousVerifiedFile(
      value.runDir,
      "controller-deploy-solana-config-v5.yml",
      renderSolanaConfig(value.rpcUrl, "/proc/self/fd/8"),
    );
    handles.push(configHandle);
    const artifactHandle = await anonymousVerifiedFile(
      value.runDir,
      "controller-deploy-artifact-v5.so",
      value.artifact,
    );
    handles.push(artifactHandle);
    const programHandle = await openSecureHandle(value.programKeypairPath, "controller program keypair");
    const bufferHandle = await openSecureHandle(value.bufferKeypairPath, "controller deploy buffer keypair");
    const initializerHandle = await openSecureHandle(value.initializerPath, "controller initializer keypair");
    const payerHandle = await openSecureHandle(value.feePayerPath, "fee payer keypair");
    handles.push(programHandle, bufferHandle, initializerHandle, payerHandle);
    await solanaAddressFromHandle(programHandle, EXPECTED_CONTROLLER_PROGRAM, "controller program");
    await solanaAddressFromHandle(bufferHandle, EXPECTED_DEPLOY_BUFFER, "controller deploy buffer");
    await solanaAddressFromHandle(initializerHandle, EXPECTED_INITIALIZER, "controller initializer");
    await solanaAddressFromHandle(payerHandle, EXPECTED_FEE_PAYER, "fee payer");
    assertCliDevnet(configHandle);

    const immediateSlot = await assertAbsent(value.connection, value.controllerProgram, value.controllerProgramdata, value.buffer);
    assert(immediateSlot <= plan.planValidUntilSlot, "controller deploy plan expired immediately before submission");
    const immediateFunding = await fundingSnapshot(value.connection, value.artifact.length);
    for (const [field, expected] of Object.entries(immediateFunding)) {
      assert.equal(plan[field], expected, `controller deploy funding field ${field} changed immediately before submission`);
    }

    result = spawnWithHandles([
      "program", "deploy",
      "--config", "/proc/self/fd/3",
      "--program-id", "/proc/self/fd/5",
      "--buffer", "/proc/self/fd/6",
      "--upgrade-authority", "/proc/self/fd/7",
      "--fee-payer", "/proc/self/fd/8",
      "--max-len", String(value.artifact.length),
      "--max-sign-attempts", "1",
      "--commitment", "finalized",
      "--use-rpc",
      "--output", "json",
      "/proc/self/fd/4",
    ], handles);
  } finally {
    await Promise.all(handles.map((handle) => handle.close()));
  }
  if (result.status !== 0) commandFailure("controller deploy", result);
  const deployment = JSON.parse(result.stdout);
  assertExactKeys(deployment, ["programId", "signature"], "Solana CLI deploy output");
  assert.equal(deployment.programId, value.controllerProgram.toBase58(), "Solana CLI returned a different program ID");
  const transactionSignature = assertSolanaSignature(deployment.signature);
  const transaction = await verifyFinalizedTransaction(value.connection, transactionSignature);

  const response = await value.connection.getMultipleAccountsInfoAndContext(
    [value.controllerProgram, value.controllerProgramdata, value.buffer],
    { commitment: "finalized" },
  );
  const state = parseLoaderState({
    program: response.value[0],
    programdata: response.value[1],
  }, value.controllerProgramdata, EXPECTED_INITIALIZER, value.artifact);
  assert.equal(response.value[2], null, "controller deploy buffer was not closed after deployment");
  const receipt = {
    schema: "ameba-governance-devnet-controller-deploy-receipt-v2",
    operationId: storedOperationId,
    genesisHash: EXPECTED_GENESIS,
    finalizedObservationSlot: response.context.slot,
    controllerProgram: value.controllerProgram.toBase58(),
    controllerProgramdata: value.controllerProgramdata.toBase58(),
    feePayer: EXPECTED_FEE_PAYER.toBase58(),
    initialUpgradeAuthority: EXPECTED_INITIALIZER.toBase58(),
    buffer: value.buffer.toBase58(),
    rpcProviderOriginSha256: plan.rpcProviderOriginSha256,
    transactionSignature,
    ...transaction,
    ...state,
  };
  await writeExclusiveJson(path.join(value.runDir, "controller-deploy-receipt.json"), receipt);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

async function executeRecoveryDeploy() {
  const value = await inputs();
  const planPath = path.join(value.runDir, "controller-deploy-recovery-plan-v6.json");
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  assertExactKeys(plan, RECOVERY_PLAN_KEYS, "controller deploy recovery plan");
  const { operationId: storedOperationId, ...material } = plan;
  assert.equal(operationId(material), storedOperationId, "deploy recovery plan operation ID changed");
  assert.equal(requiredEnvironment("AMEBA_CEREMONY_ARM"), storedOperationId, "deploy recovery operation is not explicitly armed");
  assert.equal(plan.schema, "ameba-governance-devnet-controller-deploy-recovery-plan-v6");
  assert.equal(plan.genesisHash, EXPECTED_GENESIS);
  assert.equal(plan.controllerProgram, value.controllerProgram.toBase58());
  assert.equal(plan.controllerProgramdata, value.controllerProgramdata.toBase58());
  assert.equal(plan.buffer, value.buffer.toBase58());
  assert.equal(plan.artifactSha256, sha256(value.artifact));
  assert.equal(plan.artifactBytes, value.artifact.length);
  assert.equal(plan.exactProgramdataCapacity, value.artifact.length);
  assert.equal(plan.feePayer, EXPECTED_FEE_PAYER.toBase58());
  assert.equal(plan.initialUpgradeAuthority, EXPECTED_INITIALIZER.toBase58());
  assert.equal(plan.loader, LOADER.toBase58());
  assert.equal(plan.commitment, "finalized");
  assert.equal(plan.rpcProviderOriginSha256, rpcProviderOriginSha256(value.stateRpcOrigin));
  assert.equal(plan.mainnetAllowed, false);
  assert.equal(plan.bufferAlreadyFunded, true);
  assert.equal(plan.recoveryFromOperationId, FAILED_V5_OPERATION_ID);
  assert.equal(plan.recoveryStdoutSha256, FAILED_V5_STDOUT_SHA256);
  assert.equal(plan.recoveryStderrSha256, FAILED_V5_STDERR_SHA256);
  assert.equal(plan.recoveryBufferRawSha256, RECOVERY_BUFFER_RAW_SHA256);
  assert.equal(plan.recoveryBufferPayloadSha256, RECOVERY_BUFFER_PAYLOAD_SHA256);
  assert.equal(plan.recoveryBufferLamports, RECOVERY_BUFFER_LAMPORTS);
  const priorPlanBytes = await readFile(path.join(value.runDir, "controller-deploy-plan-v5.json"));
  assert.equal(plan.recoveryPlanV5Sha256, sha256(priorPlanBytes), "failed v5 plan evidence changed");
  assert(Number.isSafeInteger(plan.observedSlot) && Number.isSafeInteger(plan.planValidUntilSlot) && plan.planValidUntilSlot === plan.observedSlot + 1_000);
  const currentRecovery = await assertRecoverableV5Buffer(
    value.connection,
    value.controllerProgram,
    value.controllerProgramdata,
    value.buffer,
    value.artifact.length,
  );
  assert(currentRecovery.observationSlot <= plan.planValidUntilSlot, "controller deploy recovery plan expired");
  assert.equal(plan.recoveryBufferAuthority, currentRecovery.bufferAuthority);
  assert.equal(plan.recoveryBufferLamports, currentRecovery.bufferLamports);
  assert.equal(plan.recoveryBufferRawBytes, currentRecovery.bufferRawBytes);
  assert.equal(plan.recoveryBufferRawSha256, currentRecovery.bufferRawSha256);
  assert.equal(plan.recoveryBufferPayloadBytes, currentRecovery.bufferPayloadBytes);
  assert.equal(plan.recoveryBufferPayloadSha256, currentRecovery.bufferPayloadSha256);
  const currentFunding = await fundingSnapshot(value.connection, value.artifact.length, true);
  for (const [field, expected] of Object.entries(currentFunding)) {
    assert.equal(plan[field], expected, `controller deploy recovery funding field ${field} changed`);
  }

  const handles = [];
  let result;
  try {
    const configHandle = await anonymousVerifiedFile(
      value.runDir,
      "controller-deploy-solana-config-v6.yml",
      renderSolanaConfig(value.rpcUrl, "/proc/self/fd/8"),
    );
    handles.push(configHandle);
    const artifactHandle = await anonymousVerifiedFile(
      value.runDir,
      "controller-deploy-artifact-v6.so",
      value.artifact,
    );
    handles.push(artifactHandle);
    const programHandle = await openSecureHandle(value.programKeypairPath, "controller program keypair");
    const bufferHandle = await openSecureHandle(value.bufferKeypairPath, "controller deploy buffer keypair");
    const initializerHandle = await openSecureHandle(value.initializerPath, "controller initializer keypair");
    const payerHandle = await openSecureHandle(value.feePayerPath, "fee payer keypair");
    handles.push(programHandle, bufferHandle, initializerHandle, payerHandle);
    await solanaAddressFromHandle(programHandle, EXPECTED_CONTROLLER_PROGRAM, "controller program");
    await solanaAddressFromHandle(bufferHandle, EXPECTED_DEPLOY_BUFFER, "controller deploy buffer");
    await solanaAddressFromHandle(initializerHandle, EXPECTED_INITIALIZER, "controller initializer");
    await solanaAddressFromHandle(payerHandle, EXPECTED_FEE_PAYER, "fee payer");
    assertCliDevnet(configHandle);

    const immediateRecovery = await assertRecoverableV5Buffer(
      value.connection,
      value.controllerProgram,
      value.controllerProgramdata,
      value.buffer,
      value.artifact.length,
    );
    assert(immediateRecovery.observationSlot <= plan.planValidUntilSlot, "controller deploy recovery plan expired immediately before submission");
    assert.equal(immediateRecovery.bufferRawSha256, plan.recoveryBufferRawSha256, "recovery buffer changed immediately before submission");
    const immediateFunding = await fundingSnapshot(value.connection, value.artifact.length, true);
    for (const [field, expected] of Object.entries(immediateFunding)) {
      assert.equal(plan[field], expected, `controller deploy recovery funding field ${field} changed immediately before submission`);
    }

    result = spawnWithHandles([
      "program", "deploy",
      "--config", "/proc/self/fd/3",
      "--program-id", "/proc/self/fd/5",
      "--buffer", "/proc/self/fd/6",
      "--upgrade-authority", "/proc/self/fd/7",
      "--fee-payer", "/proc/self/fd/8",
      "--max-len", String(value.artifact.length),
      "--max-sign-attempts", "1",
      "--commitment", "finalized",
      "--use-rpc",
      "--output", "json",
      "/proc/self/fd/4",
    ], handles);
  } finally {
    await Promise.all(handles.map((handle) => handle.close()));
  }
  if (result.status !== 0) commandFailure("controller deploy recovery", result);
  const deployment = JSON.parse(result.stdout);
  assertExactKeys(deployment, ["programId", "signature"], "Solana CLI recovery deploy output");
  assert.equal(deployment.programId, value.controllerProgram.toBase58(), "Solana CLI returned a different program ID");
  const transactionSignature = assertSolanaSignature(deployment.signature);
  const transaction = await verifyFinalizedTransaction(value.connection, transactionSignature);

  const response = await value.connection.getMultipleAccountsInfoAndContext(
    [value.controllerProgram, value.controllerProgramdata, value.buffer],
    { commitment: "finalized" },
  );
  const state = parseLoaderState({
    program: response.value[0],
    programdata: response.value[1],
  }, value.controllerProgramdata, EXPECTED_INITIALIZER, value.artifact);
  assert.equal(response.value[2], null, "controller deploy recovery buffer was not closed after deployment");
  const receipt = {
    schema: "ameba-governance-devnet-controller-deploy-receipt-v3",
    operationId: storedOperationId,
    recoveryFromOperationId: FAILED_V5_OPERATION_ID,
    recoveryPlanV5Sha256: plan.recoveryPlanV5Sha256,
    genesisHash: EXPECTED_GENESIS,
    finalizedObservationSlot: response.context.slot,
    controllerProgram: value.controllerProgram.toBase58(),
    controllerProgramdata: value.controllerProgramdata.toBase58(),
    feePayer: EXPECTED_FEE_PAYER.toBase58(),
    initialUpgradeAuthority: EXPECTED_INITIALIZER.toBase58(),
    buffer: value.buffer.toBase58(),
    rpcProviderOriginSha256: plan.rpcProviderOriginSha256,
    transactionSignature,
    ...transaction,
    ...state,
  };
  await writeExclusiveJson(path.join(value.runDir, "controller-deploy-receipt.json"), receipt);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

function redactTransportOutput(value) {
  return value.replace(/https?:\/\/[^\s"'`]+/gu, "[REDACTED_URL]");
}

async function recordFailedCommand(runDir, file, operationIdValue, result) {
  await writeExclusiveJson(path.join(runDir, file), {
    schema: "ameba-governance-devnet-command-failure-v1",
    operationId: operationIdValue,
    exitStatus: result.status,
    stdoutSha256: sha256(Buffer.from(result.stdout ?? "", "utf8")),
    stderrSha256: sha256(Buffer.from(result.stderr ?? "", "utf8")),
    stdoutRedacted: redactTransportOutput(result.stdout ?? ""),
    stderrRedacted: redactTransportOutput(result.stderr ?? ""),
  });
}

async function executeResumeDeployV7() {
  const value = await inputs();
  assert.equal(value.rpcSelection, "helius-state", "v7 resume requires the dedicated Helius Devnet state RPC");
  const planPath = path.join(value.runDir, "controller-deploy-resume-plan-v7.json");
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  assertExactKeys(plan, RESUME_V7_PLAN_KEYS, "controller deploy v7 resume plan");
  const { operationId: storedOperationId, ...material } = plan;
  assert.equal(operationId(material), storedOperationId, "deploy v7 resume plan operation ID changed");
  assert.equal(requiredEnvironment("AMEBA_CEREMONY_ARM"), storedOperationId, "deploy v7 resume is not explicitly armed");
  assert.equal(plan.schema, "ameba-governance-devnet-controller-deploy-resume-plan-v7");
  assert.equal(plan.genesisHash, EXPECTED_GENESIS);
  assert.equal(plan.controllerProgram, value.controllerProgram.toBase58());
  assert.equal(plan.controllerProgramdata, value.controllerProgramdata.toBase58());
  assert.equal(plan.buffer, value.buffer.toBase58());
  assert.equal(plan.artifactSha256, sha256(value.artifact));
  assert.equal(plan.artifactBytes, value.artifact.length);
  assert.equal(plan.exactProgramdataCapacity, value.artifact.length);
  assert.equal(plan.feePayer, EXPECTED_FEE_PAYER.toBase58());
  assert.equal(plan.initialUpgradeAuthority, EXPECTED_INITIALIZER.toBase58());
  assert.equal(plan.loader, LOADER.toBase58());
  assert.equal(plan.commitment, "finalized");
  assert.equal(plan.rpcSelection, value.rpcSelection);
  assert.equal(plan.rpcProviderOriginSha256, rpcProviderOriginSha256(value.stateRpcOrigin));
  assert.equal(plan.mainnetAllowed, false);
  assert.equal(plan.bufferAlreadyFunded, true);
  assert.equal(plan.recoveryFromOperationId, FAILED_V6_OPERATION_ID);
  assert.equal(plan.recoveryStdoutSha256, FAILED_V5_STDOUT_SHA256);
  assert.equal(plan.recoveryStderrSha256, FAILED_V5_STDERR_SHA256);
  assert.equal(plan.recoveryBufferRawSha256, RESUME_V7_BUFFER_RAW_SHA256);
  assert.equal(plan.recoveryBufferPayloadSha256, RESUME_V7_BUFFER_PAYLOAD_SHA256);
  assert.equal(plan.recoveryBufferLamports, RECOVERY_BUFFER_LAMPORTS);
  assert.equal(plan.resumeExactWriteCount, RESUME_V7_EXACT_WRITE_COUNT);
  assert.equal(plan.resumeExactWrittenBytes, RESUME_V7_EXACT_WRITTEN_BYTES);
  assert.equal(plan.resumeWriteManifestSha256, RESUME_V7_WRITE_MANIFEST_SHA256);
  const priorPlanBytes = await readFile(path.join(value.runDir, "controller-deploy-recovery-plan-v6.json"));
  assert.equal(plan.recoveryPlanV6Sha256, sha256(priorPlanBytes), "failed v6 plan evidence changed");
  assert(Number.isSafeInteger(plan.observedSlot) && Number.isSafeInteger(plan.planValidUntilSlot) && plan.planValidUntilSlot === plan.observedSlot + 2_000);
  const currentRecovery = await assertRecoverableV6Buffer(
    value.connection,
    value.controllerProgram,
    value.controllerProgramdata,
    value.buffer,
    value.artifact.length,
  );
  assert(currentRecovery.observationSlot <= plan.planValidUntilSlot, "controller deploy v7 resume plan expired");
  assert.equal(plan.recoveryBufferAuthority, currentRecovery.bufferAuthority);
  assert.equal(plan.recoveryBufferLamports, currentRecovery.bufferLamports);
  assert.equal(plan.recoveryBufferRawBytes, currentRecovery.bufferRawBytes);
  assert.equal(plan.recoveryBufferRawSha256, currentRecovery.bufferRawSha256);
  assert.equal(plan.recoveryBufferPayloadBytes, currentRecovery.bufferPayloadBytes);
  assert.equal(plan.recoveryBufferPayloadSha256, currentRecovery.bufferPayloadSha256);
  const currentFunding = await fundingSnapshot(value.connection, value.artifact.length, true);
  for (const [field, expected] of Object.entries(currentFunding)) {
    assert.equal(plan[field], expected, `controller deploy v7 funding field ${field} changed`);
  }

  const handles = [];
  let result;
  try {
    const configHandle = await anonymousVerifiedFile(
      value.runDir,
      "controller-deploy-solana-config-v7.yml",
      renderSolanaConfig(value.rpcUrl, "/proc/self/fd/8"),
    );
    handles.push(configHandle);
    const artifactHandle = await anonymousVerifiedFile(
      value.runDir,
      "controller-deploy-artifact-v7.so",
      value.artifact,
    );
    handles.push(artifactHandle);
    const programHandle = await openSecureHandle(value.programKeypairPath, "controller program keypair");
    const bufferHandle = await openSecureHandle(value.bufferKeypairPath, "controller deploy buffer keypair");
    const initializerHandle = await openSecureHandle(value.initializerPath, "controller initializer keypair");
    const payerHandle = await openSecureHandle(value.feePayerPath, "fee payer keypair");
    handles.push(programHandle, bufferHandle, initializerHandle, payerHandle);
    await solanaAddressFromHandle(programHandle, EXPECTED_CONTROLLER_PROGRAM, "controller program");
    await solanaAddressFromHandle(bufferHandle, EXPECTED_DEPLOY_BUFFER, "controller deploy buffer");
    await solanaAddressFromHandle(initializerHandle, EXPECTED_INITIALIZER, "controller initializer");
    await solanaAddressFromHandle(payerHandle, EXPECTED_FEE_PAYER, "fee payer");
    assertCliDevnet(configHandle);

    const immediateRecovery = await assertRecoverableV6Buffer(
      value.connection,
      value.controllerProgram,
      value.controllerProgramdata,
      value.buffer,
      value.artifact.length,
    );
    assert(immediateRecovery.observationSlot <= plan.planValidUntilSlot, "controller deploy v7 resume plan expired immediately before submission");
    assert.equal(immediateRecovery.bufferRawSha256, plan.recoveryBufferRawSha256, "v7 resume buffer changed immediately before submission");
    const immediateFunding = await fundingSnapshot(value.connection, value.artifact.length, true);
    for (const [field, expected] of Object.entries(immediateFunding)) {
      assert.equal(plan[field], expected, `controller deploy v7 funding field ${field} changed immediately before submission`);
    }

    result = spawnWithHandles([
      "program", "deploy",
      "--config", "/proc/self/fd/3",
      "--program-id", "/proc/self/fd/5",
      "--buffer", "/proc/self/fd/6",
      "--upgrade-authority", "/proc/self/fd/7",
      "--fee-payer", "/proc/self/fd/8",
      "--max-len", String(value.artifact.length),
      "--max-sign-attempts", "1",
      "--commitment", "finalized",
      "--use-rpc",
      "--output", "json",
      "/proc/self/fd/4",
    ], handles);
  } finally {
    await Promise.all(handles.map((handle) => handle.close()));
  }
  if (result.status !== 0) {
    await recordFailedCommand(value.runDir, "controller-deploy-resume-v7-failure.json", storedOperationId, result);
    commandFailure("controller deploy v7 resume", result);
  }
  const deployment = JSON.parse(result.stdout);
  assertExactKeys(deployment, ["programId", "signature"], "Solana CLI v7 deploy output");
  assert.equal(deployment.programId, value.controllerProgram.toBase58(), "Solana CLI returned a different program ID");
  const transactionSignature = assertSolanaSignature(deployment.signature);
  const transaction = await verifyFinalizedTransaction(value.connection, transactionSignature);

  const response = await value.connection.getMultipleAccountsInfoAndContext(
    [value.controllerProgram, value.controllerProgramdata, value.buffer],
    { commitment: "finalized" },
  );
  const state = parseLoaderState({
    program: response.value[0],
    programdata: response.value[1],
  }, value.controllerProgramdata, EXPECTED_INITIALIZER, value.artifact);
  assert.equal(response.value[2], null, "controller deploy v7 buffer was not closed after deployment");
  const receipt = {
    schema: "ameba-governance-devnet-controller-deploy-receipt-v4",
    operationId: storedOperationId,
    recoveryFromOperationId: FAILED_V6_OPERATION_ID,
    recoveryPlanV5Sha256: plan.recoveryPlanV5Sha256,
    recoveryPlanV6Sha256: plan.recoveryPlanV6Sha256,
    resumeExactWriteCount: plan.resumeExactWriteCount,
    resumeExactWrittenBytes: plan.resumeExactWrittenBytes,
    resumeWriteManifestSha256: plan.resumeWriteManifestSha256,
    genesisHash: EXPECTED_GENESIS,
    finalizedObservationSlot: response.context.slot,
    controllerProgram: value.controllerProgram.toBase58(),
    controllerProgramdata: value.controllerProgramdata.toBase58(),
    feePayer: EXPECTED_FEE_PAYER.toBase58(),
    initialUpgradeAuthority: EXPECTED_INITIALIZER.toBase58(),
    buffer: value.buffer.toBase58(),
    rpcSelection: value.rpcSelection,
    rpcProviderOriginSha256: plan.rpcProviderOriginSha256,
    transactionSignature,
    ...transaction,
    ...state,
  };
  await writeExclusiveJson(path.join(value.runDir, "controller-deploy-receipt.json"), receipt);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

const mode = process.argv[2];
if (mode === "plan") await planDeploy();
else if (mode === "execute") await executeDeploy();
else if (mode === "plan-recovery") await planRecoveryDeploy();
else if (mode === "execute-recovery") await executeRecoveryDeploy();
else if (mode === "plan-resume-v7") await planResumeDeployV7();
else if (mode === "execute-resume-v7") await executeResumeDeployV7();
else throw new Error("expected plan, execute, plan-recovery, execute-recovery, plan-resume-v7, or execute-resume-v7 mode");
