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
  const { stateRpcOrigin, stateRpcUrl: rpcUrl } = await loadDevnetRpcConfiguration();
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

async function fundingSnapshot(connection, artifactLength) {
  const [feePayerBalanceLamports, programRentLamports, programdataRentLamports, bufferRentLamports] = await Promise.all([
    connection.getBalance(EXPECTED_FEE_PAYER, "finalized"),
    connection.getMinimumBalanceForRentExemption(36, "finalized"),
    connection.getMinimumBalanceForRentExemption(45 + artifactLength, "finalized"),
    connection.getMinimumBalanceForRentExemption(37 + artifactLength, "finalized"),
  ]);
  const peakRequiredLamports = programRentLamports + programdataRentLamports + bufferRentLamports + 500_000_000;
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
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    const status = await handle.stat();
    assert(status.isFile(), `${name} staging descriptor is not a regular file`);
    assert.equal(status.size, bytes.length, `${name} staging length changed`);
    if (typeof process.getuid === "function") {
      assert.equal(status.uid, process.getuid(), `${name} staging file must be owned by the current user`);
    }
    assert.equal(status.mode & 0o077, 0, `${name} staging file must not grant group or other permissions`);
    await unlink(file);
    return handle;
  } catch (error) {
    await handle.close();
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

const mode = process.argv[2];
if (mode === "plan") await planDeploy();
else if (mode === "execute") await executeDeploy();
else throw new Error("expected plan or execute mode");
