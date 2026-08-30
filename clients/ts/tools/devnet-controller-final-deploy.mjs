import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, lstat, open, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import bs58Module from "bs58";
import {
  Connection,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  loadInjectedSignerProvider,
  signTransactionWithProvider,
  withExecutionLock,
} from "./devnet-ceremony-runtime.mjs";

import {
  loadDevnetRpcConfiguration,
  requireSecureDirectory,
  requireSecureRegularFile,
} from "./secure-rpc-env.mjs";

const bs58 = bs58Module.default ?? bs58Module;

const EXPECTED_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const FEE_PAYER = new PublicKey("G2f6Fv477ZyFbmRFtVr21jf9VufXpiRCxf1e91J6SxxT");
const INITIALIZER = new PublicKey("7wHuwk8DkqCN7vuEWzLhfLDQeiUUKKYfocjjDL5mxQvZ");
const CONTROLLER_PROGRAM = new PublicKey("CzyGUEVtLg2FTWdZmQ6KZCydw73KutLtE6c5PJgnxQqa");
const CONTROLLER_PROGRAMDATA = new PublicKey("H9zckD4ukjmKQL6tF5G9uZWixKomxeXxW2CPA3MkgPN9");
const BUFFER = new PublicKey("9DAowZpMbWKNAvjz81HXKQqUJbaTiQ9RZmgu5xgddogM");

const ARTIFACT_BYTES = 1_114_592;
const ARTIFACT_SHA256 = "0c107bce1ec34d3badf72b69161f0cae0b82a7b85ea714770f3876c08e6c1b18";
const SOURCE_REPOSITORY = "https://github.com/SPACE999978/ameba_gov";
const SOURCE_COMMIT = "9f3414315d53f70fe029c7f3480c9d45b8674da2";
const SOURCE_TREE = "854f20940fd701c2c5a9716b7a71dc174dd7c8c2";
const SOURCE_CARGO_LOCK_SHA256 = "0c26b200f23a65d0976f30474208b74a64f04623f16d539e6b805c4fcf98768d";
const SBPF_ARCHITECTURE = "v0";

const PROGRAM_BYTES = 36;
const PROGRAMDATA_HEADER_BYTES = 45;
const PROGRAMDATA_BYTES = PROGRAMDATA_HEADER_BYTES + ARTIFACT_BYTES;
const BUFFER_HEADER_BYTES = 37;
const BUFFER_BYTES = BUFFER_HEADER_BYTES + ARTIFACT_BYTES;
const BUFFER_RENT_MINIMUM_LAMPORTS = 7_758_708_720;
const BUFFER_LAMPORTS = 7_758_764_400;
const MAX_PACKET_BYTES = 1_232;
const PLAN_VALIDITY_SLOTS = 2_000;
const FUNDING_MARGIN_LAMPORTS = 500_000_000;
const MAX_FEE_LAMPORTS = 100_000;
const INITIAL_RATE_LIMIT_BACKOFF_MS = 30_000;
const FINALIZED_STATUS_POLL_INTERVAL_MS = 30_000;
const MAX_RATE_LIMIT_BACKOFF_MS = 10 * 60_000;

const LOADER_INTERFACE_CRATE = "solana-loader-v3-interface";
const LOADER_INTERFACE_VERSION = "5.0.0";
const LOADER_INTERFACE_CHECKSUM = "6f7162a05b8b0773156b443bccd674ea78bb9aa406325b467ea78c06c99a63a2";
const LOADER_INTERFACE_INSTRUCTION_SOURCE_SHA256 = "93d8b95d1739babc7206909cb1ed074da0d1884005b2245cdfa7e224609d503e";
const LOADER_PROCESSOR_CRATE = "solana-bpf-loader-program";
const LOADER_PROCESSOR_VERSION = "2.3.13";
const LOADER_PROCESSOR_SOURCE_SHA256 = "8097ca702f1f54960615362022f6ce72e69f871eabdb5ae91607f1c12b068b89";
const DEPLOY_VARIANT_INDEX = 2;
const DEPLOY_DATA_GOLDEN_HEX = "02000000e001110000000000";

const BUFFER_UPLOAD_PLAN_SCHEMA = "ameba-governance-devnet-controller-buffer-upload-plan-v1";
const BUFFER_UPLOAD_PLAN_FILE = "controller-buffer-upload-plan-v1.json";
const BUFFER_UPLOAD_JOURNAL_FILE = "controller-buffer-upload-journal-v1.jsonl";
const BUFFER_UPLOAD_TOOL_FILE = "devnet-controller-buffer-upload.mjs";
const BUFFER_UPLOAD_TOOL_SHA256 = "9bab1abf5d0a91e0998132c51aa28b6df17114b9c21ace2a24f76d2c04ea4410";

const PLAN_SCHEMA = "ameba-governance-devnet-controller-final-deploy-plan-v1";
const PLAN_FILE = "controller-final-deploy-plan-v1.json";
const PLAN_FILE_PATTERN = /^controller-final-deploy-plan-v1(?:-([0-9a-f]{64}))?\.json$/u;
const JOURNAL_FILE = "controller-final-deploy-journal-v1.jsonl";
const JOURNAL_FILE_PATTERN = /^controller-final-deploy-journal-v1(?:-([0-9a-f]{64}))?\.jsonl$/u;
const CEREMONY_RPC_OWNER_LOCK = "release1-devnet-rpc-owner";
const DEPLOYMENT_MANIFEST_SCHEMA = "amoeba-controller-deployment-manifest-v2";
const DEPLOYMENT_MANIFEST_FILE = "controller-deployment-manifest-v2.json";
const ZERO_HASH = "0".repeat(64);
const PINNED_PREPARED_RECOVERY = Object.freeze({
  operationId: "0236f8ae13269fec3472b44105a91b4278218748666f741952dfd2b1865ca24d",
  planSha256: "b2a00a168176db3d51e5c57f3db0d364755751fcc9763b639dd8b4b442f118bf",
  supersededToolSha256: "cc62696427f5cb4d3ab26ca4146805ebe133409a6ab8af728e219e0e603a4b50",
  sessionEntrySha256: "571c14478af7064d99afbd5a5c661699d89bc76ee306ba61dcbf6b0c089ce254",
  decodedActionEntrySha256: "ec5deb51f1a7bc7b403a329d2cde8207a8913449bf6c5ba41883919e9314a195",
  preparedEntrySha256: "307634fef54f4912849eb25c9ea43bb05643c3e45f5a163997e6ed6f26a073ec",
  signature: "3LHdof3gPJkWNKG238YN1xngjPp5kpeQLZjfkCiPftcPwWukeAfeWeR9GNNfvgCw9pHeNEEbiteDQHduuwcREXqF",
  blockhash: "JWyUvA73oiF15rRKrRPtVReyET56n52Ecu4rcJkXgbr",
  lastValidBlockHeight: 478_097_828,
  preflightSlot: 490_302_974,
  providerId: "ameba-local-bootstrap-keypair-v2/e137506872cad2dc3dee74a835cdcd5a5ea64571550823e5a36034ec778d8fbf",
  providerModuleSha256: "39e5cd2b422cfd2646432d3554275118d99f4fda19fd735a28c4d56eb1ad33ab",
  actionManifestSha256: "015c18fc2755739c9e15e3bc7d42c088220dd65e9cb63a45a96fc12d1ee61f2c",
  messageSha256: "38573dc16cc0a03fa4e0e763aeec4be04406c944b725b19189428df76cf65b7d",
  wireSha256: "e54d351137cf5e779137c7001c13f8e48f4d2945261a4d37486d8264cd18f97d",
  wireBytes: 598,
});
let safeDiagnosticStage = "entry";

function setSafeDiagnosticStage(stage) {
  assert(typeof stage === "string" && /^[a-z0-9][a-z0-9-]*$/u.test(stage), "safe diagnostic stage is invalid");
  safeDiagnosticStage = stage;
}

function safeDiagnostic(error) {
  if (process.env.AMEBA_CEREMONY_SAFE_DIAGNOSTIC !== "1") return null;
  const stack = String(error?.stack ?? "");
  const lineMatch = /devnet-controller-final-deploy\.mjs:(\d+):(\d+)/u.exec(stack);
  return {
    schema: "ameba-controller-final-deploy-safe-diagnostic-v1",
    stage: safeDiagnosticStage,
    errorClass: error?.code === "ERR_ASSERTION" ? "assertion" : "error",
    toolLine: lineMatch === null ? null : Number(lineMatch[1]),
  };
}

const DEPLOYMENT_MANIFEST_KEYS = [
  "authorizedForInitializationEvidence",
  "bufferUpload",
  "build",
  "cluster",
  "controller",
  "deployment",
  "evidence",
  "funding",
  "loader",
  "mainnetAllowed",
  "operationId",
  "schema",
  "source",
].sort();

const BUFFER_UPLOAD_PLAN_KEYS = [
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

const PLAN_KEYS = [
  "actionManifest",
  "artifact",
  "bufferUpload",
  "cluster",
  "controller",
  "expectedPoststate",
  "funding",
  "loaderEncoding",
  "mainnetAllowed",
  "operationId",
  "planningTransaction",
  "prestate",
  "schema",
  "source",
  "toolSha256",
].sort();

const ALLOWED_UPLOAD_JOURNAL_EVENTS = new Set([
  "backoff-derived",
  "batch-verified",
  "complete",
  "expired-unaccepted",
  "finalized",
  "prepared",
  "rate-limited",
  "resubmit-prepared",
  "resubmitted",
  "send-prepared",
  "session-started",
  "submission-unknown",
  "submitted",
  "transaction-failed",
]);

const ALLOWED_DEPLOY_JOURNAL_EVENTS = new Set([
  "complete",
  "decoded-action-displayed",
  "expired-unaccepted",
  "finalized",
  "manifest-written",
  "poststate-verified",
  "prepared",
  "rate-limited",
  "resubmit-prepared",
  "resubmitted",
  "send-prepared",
  "session-started",
  "simulation-failed",
  "simulation-passed",
  "submission-unknown",
  "submitted",
  "transaction-failed",
]);

class RateLimitExit extends Error {
  constructor(message, metadata) {
    super(message);
    this.metadata = metadata;
  }
}

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

function assertExactKeys(value, expected, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label} keys changed`);
}

function rpcProviderOriginSha256(origin) {
  return sha256Hex(Buffer.concat([
    Buffer.from("AMOEBA_DEVNET_RPC_PROVIDER_ORIGIN_V1", "ascii"),
    Buffer.from(origin, "utf8"),
  ]));
}

function publicKeyBytes(publicKey) {
  return Buffer.from(publicKey.toBytes());
}

function buildDeployWithMaxDataLenData(maxDataLen = ARTIFACT_BYTES) {
  assert.equal(maxDataLen, ARTIFACT_BYTES, "controller ProgramData capacity must equal the artifact length");
  const data = Buffer.alloc(12);
  data.writeUInt32LE(DEPLOY_VARIANT_INDEX, 0);
  data.writeBigUInt64LE(BigInt(maxDataLen), 4);
  assert.equal(data.toString("hex"), DEPLOY_DATA_GOLDEN_HEX, "Loader-v3 DeployWithMaxDataLen bincode golden changed");
  return data;
}

function expectedProgramBytes() {
  const raw = Buffer.alloc(PROGRAM_BYTES);
  raw.writeUInt32LE(2, 0);
  publicKeyBytes(CONTROLLER_PROGRAMDATA).copy(raw, 4);
  return raw;
}

function expectedProgramdataBytes(slot, artifact) {
  assert(Number.isSafeInteger(slot) && slot > 0, "deployed slot is invalid");
  assert.equal(artifact.length, ARTIFACT_BYTES, "controller artifact length changed");
  const raw = Buffer.alloc(PROGRAMDATA_BYTES);
  raw.writeUInt32LE(3, 0);
  raw.writeBigUInt64LE(BigInt(slot), 4);
  raw[12] = 1;
  publicKeyBytes(INITIALIZER).copy(raw, 13);
  artifact.copy(raw, PROGRAMDATA_HEADER_BYTES);
  return raw;
}

function expectedBufferBytes(artifact) {
  assert.equal(artifact.length, ARTIFACT_BYTES, "controller artifact length changed");
  const raw = Buffer.alloc(BUFFER_BYTES);
  raw.writeUInt32LE(1, 0);
  raw[4] = 1;
  publicKeyBytes(INITIALIZER).copy(raw, 5);
  artifact.copy(raw, BUFFER_HEADER_BYTES);
  return raw;
}

function createDeploymentInstructions(programRentLamports) {
  assert(Number.isSafeInteger(programRentLamports) && programRentLamports > 0, "Program rent is invalid");
  const createProgram = SystemProgram.createAccount({
    fromPubkey: FEE_PAYER,
    newAccountPubkey: CONTROLLER_PROGRAM,
    lamports: programRentLamports,
    space: PROGRAM_BYTES,
    programId: LOADER,
  });
  const deploy = new TransactionInstruction({
    programId: LOADER,
    keys: [
      { pubkey: FEE_PAYER, isSigner: true, isWritable: true },
      { pubkey: CONTROLLER_PROGRAMDATA, isSigner: false, isWritable: true },
      { pubkey: CONTROLLER_PROGRAM, isSigner: false, isWritable: true },
      { pubkey: BUFFER, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: INITIALIZER, isSigner: true, isWritable: false },
    ],
    data: buildDeployWithMaxDataLenData(),
  });
  assert.equal(createProgram.keys.length, 2, "System CreateAccount account contract changed");
  assert(createProgram.keys[0].pubkey.equals(FEE_PAYER) && createProgram.keys[0].isSigner && createProgram.keys[0].isWritable);
  assert(createProgram.keys[1].pubkey.equals(CONTROLLER_PROGRAM) && createProgram.keys[1].isSigner && createProgram.keys[1].isWritable);
  return [createProgram, deploy];
}

function instructionManifest(instruction) {
  return {
    programId: instruction.programId.toBase58(),
    accounts: instruction.keys.map((meta) => ({
      pubkey: meta.pubkey.toBase58(),
      isSigner: meta.isSigner,
      isWritable: meta.isWritable,
    })),
    dataHex: Buffer.from(instruction.data).toString("hex"),
  };
}

function createActionManifest(programRentLamports) {
  const instructions = createDeploymentInstructions(programRentLamports);
  return {
    schema: "ameba-controller-final-deploy-action-v1",
    instructionCount: 2,
    signerOrder: [FEE_PAYER, CONTROLLER_PROGRAM, INITIALIZER].map((key) => key.toBase58()),
    instructions: instructions.map(instructionManifest),
  };
}

function unsignedPlanningTransaction(blockhash, programRentLamports) {
  const transaction = new Transaction({ feePayer: FEE_PAYER, recentBlockhash: blockhash });
  transaction.add(...createDeploymentInstructions(programRentLamports));
  const wire = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
  const signerOrder = transaction.signatures.map((entry) => entry.publicKey.toBase58());
  assert.deepEqual(signerOrder, [FEE_PAYER, CONTROLLER_PROGRAM, INITIALIZER].map((key) => key.toBase58()), "deployment signer order changed");
  assert(wire.length <= MAX_PACKET_BYTES, "controller deployment transaction exceeds the packet limit");
  return {
    message: transaction.compileMessage(),
    messageSha256: sha256Hex(transaction.serializeMessage()),
    packetBytes: wire.length,
    signerOrder,
  };
}

function expectedDeploymentMessage(blockhash, programRentLamports) {
  const expected = new Transaction({ feePayer: FEE_PAYER, recentBlockhash: blockhash });
  expected.add(...createDeploymentInstructions(programRentLamports));
  return Buffer.from(expected.serializeMessage());
}

function assertExactPreparedMessage(transaction, entry, plan) {
  const actualMessage = Buffer.from(transaction.serializeMessage());
  const expectedMessage = expectedDeploymentMessage(
    entry.blockhash,
    plan.funding.programRentLamports,
  );
  assert.equal(sha256Hex(actualMessage), entry.messageSha256, "deployment prepared message hash changed");
  assert(
    actualMessage.equals(expectedMessage),
    "deployment prepared compiled message differs from the exact reviewed action",
  );
}

function assertExactRentBinding({
  bufferRentMinimumLamports,
  programdataRentMinimumLamports,
  uploadPlanBufferRentMinimumLamports,
  actualBufferLamports,
}) {
  assert.equal(
    bufferRentMinimumLamports,
    uploadPlanBufferRentMinimumLamports,
    "current Buffer rent minimum differs from the completed upload plan",
  );
  assert.equal(
    bufferRentMinimumLamports,
    BUFFER_RENT_MINIMUM_LAMPORTS,
    "reviewed controller Buffer minimum rent changed",
  );
  assert(
    actualBufferLamports >= bufferRentMinimumLamports,
    "controller deploy Buffer is below its exact rent minimum",
  );
  assert.equal(
    actualBufferLamports,
    programdataRentMinimumLamports,
    "controller deploy Buffer balance must equal exact ProgramData rent",
  );
}

function selfTest() {
  assert.equal(buildDeployWithMaxDataLenData().toString("hex"), DEPLOY_DATA_GOLDEN_HEX);
  assert.equal(expectedProgramBytes().toString("hex"), `02000000${publicKeyBytes(CONTROLLER_PROGRAMDATA).toString("hex")}`);
  const action = createActionManifest(1_234_567);
  assert.equal(action.instructions[0].programId, SystemProgram.programId.toBase58());
  assert.equal(action.instructions[0].dataHex.length, 104, "System CreateAccount encoding length changed");
  assert.equal(action.instructions[1].programId, LOADER.toBase58());
  assert.equal(action.instructions[1].dataHex, DEPLOY_DATA_GOLDEN_HEX);
  assert.equal(action.instructions[1].accounts.length, 8);
  const planning = unsignedPlanningTransaction(EXPECTED_GENESIS, 1_234_567);
  assert(planning.packetBytes <= MAX_PACKET_BYTES);
  const unsigned = new Transaction({ feePayer: FEE_PAYER, recentBlockhash: EXPECTED_GENESIS });
  unsigned.add(...createDeploymentInstructions(1_234_567));
  const unsignedWire = unsigned.serialize({ requireAllSignatures: false, verifySignatures: false });
  const reconstructed = Transaction.from(unsignedWire);
  assert.equal(
    reconstructed.instructions[1].keys[2].isSigner,
    true,
    "self-test no longer exercises globally promoted reconstructed privileges",
  );
  assert.equal(
    createActionManifest(1_234_567).instructions[1].accounts[2].isSigner,
    false,
    "reviewed Loader instruction unexpectedly requires the Program signer",
  );
  const preparedMessageEntry = {
    blockhash: EXPECTED_GENESIS,
    messageSha256: sha256Hex(reconstructed.serializeMessage()),
  };
  const preparedMessagePlan = { funding: { programRentLamports: 1_234_567 } };
  assert.doesNotThrow(
    () => assertExactPreparedMessage(reconstructed, preparedMessageEntry, preparedMessagePlan),
    "exact compiled message rejected harmless reconstructed privilege promotion",
  );
  const alteredData = Transaction.from(unsignedWire);
  alteredData.instructions[1].data = Buffer.from(alteredData.instructions[1].data);
  alteredData.instructions[1].data[0] ^= 1;
  const negativePreparedMessageCases = [
    ["changed-compiled-data", alteredData, preparedMessagePlan],
    ["changed-program-rent", reconstructed, { funding: { programRentLamports: 1_234_568 } }],
  ];
  for (const [label, transaction, plan] of negativePreparedMessageCases) {
    assert.throws(
      () => assertExactPreparedMessage(transaction, preparedMessageEntry, plan),
      undefined,
      `compiled-message self-test accepted ${label}`,
    );
  }
  assertExactRentBinding({
    bufferRentMinimumLamports: BUFFER_RENT_MINIMUM_LAMPORTS,
    programdataRentMinimumLamports: BUFFER_LAMPORTS,
    uploadPlanBufferRentMinimumLamports: BUFFER_RENT_MINIMUM_LAMPORTS,
    actualBufferLamports: BUFFER_LAMPORTS,
  });
  const negativeRentCases = [
    ["upload-minimum", { uploadPlanBufferRentMinimumLamports: BUFFER_RENT_MINIMUM_LAMPORTS - 1 }],
    ["current-minimum", { bufferRentMinimumLamports: BUFFER_RENT_MINIMUM_LAMPORTS - 1 }],
    ["underfunded-buffer", { actualBufferLamports: BUFFER_RENT_MINIMUM_LAMPORTS - 1 }],
    ["programdata-rent", { programdataRentMinimumLamports: BUFFER_LAMPORTS + 1 }],
  ];
  for (const [label, mutation] of negativeRentCases) {
    assert.throws(() => assertExactRentBinding({
      bufferRentMinimumLamports: BUFFER_RENT_MINIMUM_LAMPORTS,
      programdataRentMinimumLamports: BUFFER_LAMPORTS,
      uploadPlanBufferRentMinimumLamports: BUFFER_RENT_MINIMUM_LAMPORTS,
      actualBufferLamports: BUFFER_LAMPORTS,
      ...mutation,
    }), undefined, `rent-binding self-test accepted ${label}`);
  }
  assert.equal(PLAN_VALIDITY_SLOTS, 2_000, "controller final-deploy plan validity changed");
  assert.equal(
    deploymentJournalBasename("a".repeat(64)),
    `controller-final-deploy-journal-v1-${"a".repeat(64)}.jsonl`,
    "operation-specific deployment journal name changed",
  );
  assert.doesNotThrow(
    () => assertJournalAllowsPlanSwitch([{ sequence: 1, event: "session-started" }], JOURNAL_FILE),
    "session-started-only journal blocked safe replan",
  );
  assert.doesNotThrow(
    () => assertJournalAllowsPlanSwitch([
      { sequence: 1, event: "prepared", signature: "expired-signature" },
      { sequence: 2, event: "expired-unaccepted", signature: "expired-signature" },
    ], "expired-prepared"),
    "proven-expired prepared attempt blocked safe replan",
  );
  assert.doesNotThrow(
    () => assertJournalAllowsPlanSwitch([
      { sequence: 1, event: "prepared", signature: "failed-signature" },
      { sequence: 2, event: "transaction-failed", signature: "failed-signature" },
    ], "failed-prepared"),
    "finalized failed prepared attempt blocked safe replan",
  );
  assert.doesNotThrow(
    () => assertJournalAllowsPlanSwitch([
      { sequence: 1, event: "rate-limited", nextAttemptNotBefore: new Date(Date.now() - 1_000).toISOString() },
    ], "elapsed-backoff"),
    "elapsed journaled backoff blocked safe replan",
  );
  const negativeJournalSwitchCases = [
    ["active-backoff", [{
      sequence: 1,
      event: "rate-limited",
      nextAttemptNotBefore: new Date(Date.now() + 60_000).toISOString(),
    }]],
    ["unresolved-prepared", [{ sequence: 1, event: "prepared", signature: "pending" }]],
    ["submission-unknown", [
      { sequence: 1, event: "prepared", signature: "unknown" },
      { sequence: 2, event: "submission-unknown", signature: "unknown" },
    ]],
    ["simulation-failed-with-live-blockhash", [
      { sequence: 1, event: "prepared", signature: "simulation" },
      { sequence: 2, event: "simulation-failed", signature: "simulation" },
    ]],
    ["finalized", [
      { sequence: 1, event: "prepared", signature: "finalized" },
      { sequence: 2, event: "finalized", signature: "finalized" },
    ]],
  ];
  for (const [label, entries] of negativeJournalSwitchCases) {
    assert.throws(
      () => assertJournalAllowsPlanSwitch(entries, label),
      undefined,
      `journal-switch self-test accepted ${label}`,
    );
  }
  const pinnedEntry = {
    attempt: 1,
    signature: PINNED_PREPARED_RECOVERY.signature,
    blockhash: PINNED_PREPARED_RECOVERY.blockhash,
    lastValidBlockHeight: PINNED_PREPARED_RECOVERY.lastValidBlockHeight,
    preflightSlot: PINNED_PREPARED_RECOVERY.preflightSlot,
    signerProvider: {
      providerId: PINNED_PREPARED_RECOVERY.providerId,
      providerKind: "wallet",
      providerModuleSha256: PINNED_PREPARED_RECOVERY.providerModuleSha256,
    },
    actionManifestSha256: PINNED_PREPARED_RECOVERY.actionManifestSha256,
    messageSha256: PINNED_PREPARED_RECOVERY.messageSha256,
    wireSha256: PINNED_PREPARED_RECOVERY.wireSha256,
    wireBytes: PINNED_PREPARED_RECOVERY.wireBytes,
  };
  const pinnedPlanValue = {
    pinnedPreparedRecovery: true,
    plan: { operationId: PINNED_PREPARED_RECOVERY.operationId },
    planSha256: PINNED_PREPARED_RECOVERY.planSha256,
  };
  const pinnedEntries = [
    { entrySha256: PINNED_PREPARED_RECOVERY.sessionEntrySha256 },
    { entrySha256: PINNED_PREPARED_RECOVERY.decodedActionEntrySha256 },
    { entrySha256: PINNED_PREPARED_RECOVERY.preparedEntrySha256 },
  ];
  assert.doesNotThrow(
    () => assertPinnedPreparedRecoveryJournal(
      pinnedPlanValue,
      { attempts: [{ entry: pinnedEntry }] },
      pinnedEntries,
    ),
    "exact pinned prepared recovery was rejected",
  );
  const negativePinnedRecoveryCases = [
    ["second-attempt", { attempts: [{ entry: pinnedEntry }, { entry: pinnedEntry }] }],
    ["changed-wire", { attempts: [{ entry: { ...pinnedEntry, wireSha256: ZERO_HASH } }] }],
    ["changed-provider", { attempts: [{ entry: {
      ...pinnedEntry,
      signerProvider: { ...pinnedEntry.signerProvider, providerModuleSha256: ZERO_HASH },
    } }] }],
  ];
  for (const [label, replay] of negativePinnedRecoveryCases) {
    assert.throws(
      () => assertPinnedPreparedRecoveryJournal(pinnedPlanValue, replay, pinnedEntries),
      undefined,
      `pinned-recovery self-test accepted ${label}`,
    );
  }
  const testSignature = "prepared-signature";
  assert.deepEqual(
    deploymentSendEvents([], testSignature),
    { before: "send-prepared", after: "submitted" },
    "a never-sent prepared transaction was mislabeled as a resubmission",
  );
  assert.deepEqual(
    deploymentSendEvents([
      { event: "send-prepared", signature: testSignature },
    ], testSignature),
    { before: "resubmit-prepared", after: "resubmitted" },
    "an already-attempted prepared transaction was mislabeled as a first send",
  );
  assert.deepEqual(
    deploymentSendEvents([
      { event: "send-prepared", signature: "different-signature" },
      { event: "submitted", signature: testSignature },
    ], testSignature),
    { before: "send-prepared", after: "submitted" },
    "unrelated or non-send evidence changed prepared-transaction send attribution",
  );
  assert.equal(
    FINALIZED_STATUS_POLL_INTERVAL_MS,
    30_000,
    "finalized status polling is faster than the ceremony policy permits",
  );
  return {
    ok: true,
    loaderDeployDataHex: DEPLOY_DATA_GOLDEN_HEX,
    instructionCount: action.instructionCount,
    packetBytes: planning.packetBytes,
    planValiditySlots: PLAN_VALIDITY_SLOTS,
    compiledMessageNegativeCases: negativePreparedMessageCases.map(([label]) => label),
    rentNegativeCases: negativeRentCases.map(([label]) => label),
    journalSwitchNegativeCases: negativeJournalSwitchCases.map(([label]) => label),
    pinnedRecoveryNegativeCases: negativePinnedRecoveryCases.map(([label]) => label),
    sendAttributionCases: ["first-send", "resubmission", "foreign-evidence-ignored"],
    finalizedStatusPollIntervalMs: FINALIZED_STATUS_POLL_INTERVAL_MS,
  };
}

async function secureFileInside(runDir, input, label) {
  const file = await requireSecureRegularFile(path.resolve(input), label);
  const relative = path.relative(runDir, file);
  assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative), `${label} must be inside the ceremony run directory`);
  return file;
}

async function loadArtifact(runDir) {
  const file = await secureFileInside(runDir, requiredEnvironment("AMEBA_CONTROLLER_ARTIFACT"), "controller artifact");
  const artifact = await readFile(file);
  assert.equal(artifact.length, ARTIFACT_BYTES, "controller artifact length changed");
  assert.equal(sha256Hex(artifact), ARTIFACT_SHA256, "controller artifact SHA-256 changed");
  return { artifact, file };
}

async function readExactJson(file, expectedKeys, label) {
  const secureFile = await requireSecureRegularFile(file, label);
  const raw = await readFile(secureFile);
  const value = JSON.parse(raw.toString("utf8"));
  assertExactKeys(value, expectedKeys, label);
  return { raw, value };
}

function parseHashChainedLines(raw, operationIdValue, allowedEvents, label) {
  const text = raw.toString("utf8");
  assert(text.length > 0 && text.endsWith("\n"), `${label} is empty or has a partial tail`);
  const entries = text.slice(0, -1).split("\n").map((line) => JSON.parse(line));
  let previousEntrySha256 = ZERO_HASH;
  for (const [index, entry] of entries.entries()) {
    assert(entry && typeof entry === "object" && !Array.isArray(entry), `${label} entry is malformed`);
    assert.equal(entry.sequence, index + 1, `${label} sequence changed`);
    assert.equal(entry.operationId, operationIdValue, `${label} operation ID changed`);
    assert.equal(entry.previousEntrySha256, previousEntrySha256, `${label} hash chain changed`);
    assert(allowedEvents.has(entry.event), `${label} contains unsupported event ${String(entry.event)}`);
    assert(typeof entry.timestamp === "string" && Number.isFinite(Date.parse(entry.timestamp)), `${label} timestamp is invalid`);
    const { entrySha256, ...material } = entry;
    assert.equal(entrySha256, sha256Hex(Buffer.from(JSON.stringify(material), "utf8")), `${label} entry hash changed`);
    previousEntrySha256 = entrySha256;
  }
  return { entries, terminalEntrySha256: previousEntrySha256 };
}

function validateUploadPreparedEntry(entry, artifact, plan) {
  assert(Number.isInteger(entry.offset) && entry.offset >= 0 && entry.offset < artifact.length, "buffer-upload prepared offset is invalid");
  assert.equal(entry.offset % plan.chunkSize, 0, "buffer-upload prepared offset is not canonical");
  const chunk = artifact.subarray(entry.offset, Math.min(entry.offset + plan.chunkSize, artifact.length));
  assert.equal(entry.chunkIndex, entry.offset / plan.chunkSize, "buffer-upload prepared chunk index changed");
  assert.equal(entry.length, chunk.length, "buffer-upload prepared chunk length changed");
  assert.equal(entry.chunkSha256, sha256Hex(chunk), "buffer-upload prepared chunk hash changed");
  const wire = Buffer.from(entry.wireBase64, "base64");
  assert.equal(wire.toString("base64"), entry.wireBase64, "buffer-upload prepared wire encoding changed");
  assert.equal(wire.length, entry.wireBytes, "buffer-upload prepared wire length changed");
  assert.equal(sha256Hex(wire), entry.wireSha256, "buffer-upload prepared wire hash changed");
  assert(wire.length <= MAX_PACKET_BYTES, "buffer-upload prepared transaction exceeds the packet limit");
  const transaction = Transaction.from(wire);
  assert(transaction.verifySignatures(), "buffer-upload prepared signatures are invalid");
  assert.equal(sha256Hex(transaction.serializeMessage()), entry.messageSha256, "buffer-upload prepared message hash changed");
  assert.equal(transaction.instructions.length, 1, "buffer-upload prepared transaction has sibling instructions");
  assert.deepEqual(
    transaction.signatures.map((signature) => signature.publicKey.toBase58()),
    [FEE_PAYER, INITIALIZER].map((key) => key.toBase58()),
    "buffer-upload prepared signer order changed",
  );
  const instruction = transaction.instructions[0];
  assert(instruction.programId.equals(LOADER), "buffer-upload prepared program changed");
  assert.equal(instruction.keys.length, 2, "buffer-upload Loader Write account count changed");
  assert(instruction.keys[0].pubkey.equals(BUFFER) && !instruction.keys[0].isSigner && instruction.keys[0].isWritable, "buffer-upload Buffer meta changed");
  assert(instruction.keys[1].pubkey.equals(INITIALIZER) && instruction.keys[1].isSigner && !instruction.keys[1].isWritable, "buffer-upload authority meta changed");
  const expectedData = Buffer.alloc(16 + chunk.length);
  expectedData.writeUInt32LE(1, 0);
  expectedData.writeUInt32LE(entry.offset, 4);
  expectedData.writeBigUInt64LE(BigInt(chunk.length), 8);
  chunk.copy(expectedData, 16);
  assert(Buffer.from(instruction.data).equals(expectedData), "buffer-upload prepared Loader Write bytes changed");
}

function validateUploadCompletion(entries, artifact, plan) {
  const attempts = new Map();
  for (const entry of entries) {
    if (entry.event === "prepared") {
      validateUploadPreparedEntry(entry, artifact, plan);
      const current = attempts.get(entry.offset) ?? [];
      assert.equal(entry.attempt, current.length + 1, "buffer-upload attempt sequence changed");
      if (current.length > 0) {
        const prior = current.at(-1);
        assert(prior.expired && !prior.finalized, "buffer-upload retried a nonexpired attempt");
      }
      current.push({ entry, expired: false, failed: false, finalized: false });
      attempts.set(entry.offset, current);
      continue;
    }
    if (["expired-unaccepted", "finalized", "transaction-failed"].includes(entry.event)) {
      const attempt = (attempts.get(entry.offset) ?? []).find((candidate) => candidate.entry.signature === entry.signature);
      assert(attempt, `buffer-upload ${entry.event} refers to an unknown prepared transaction`);
      if (entry.event === "expired-unaccepted") attempt.expired = true;
      if (entry.event === "transaction-failed") attempt.failed = true;
      if (entry.event === "finalized") {
        assert.equal(entry.messageSha256, attempt.entry.messageSha256, "buffer-upload finalized message changed");
        attempt.finalized = true;
      }
    }
  }
  const baseline = new Set(plan.baselinePresentOffsets);
  const expectedOffsets = [];
  for (let offset = 0; offset < artifact.length; offset += plan.chunkSize) expectedOffsets.push(offset);
  for (const offset of expectedOffsets) {
    if (baseline.has(offset)) continue;
    const offsetAttempts = attempts.get(offset) ?? [];
    assert.equal(offsetAttempts.filter((attempt) => attempt.finalized).length, 1, `buffer-upload chunk ${offset} lacks exactly one finalized write`);
    assert(offsetAttempts.every((attempt) => !attempt.failed), `buffer-upload chunk ${offset} has a failed finalized write`);
  }
  assert.equal(
    [...attempts.values()].flat().filter((attempt) => attempt.finalized).length,
    plan.missingChunkCount,
    "buffer-upload finalized write count changed",
  );
  const completeEntries = entries.filter((entry) => entry.event === "complete");
  assert.equal(completeEntries.length, 1, "buffer-upload journal must contain one complete event");
  const complete = completeEntries[0];
  assertExactKeys(complete, [
    "controllerProgramAbsent",
    "controllerProgramdataAbsent",
    "entrySha256",
    "event",
    "exactChunkCount",
    "operationId",
    "payloadSha256",
    "previousEntrySha256",
    "rawSha256",
    "sequence",
    "slot",
    "timestamp",
  ], "buffer-upload complete event");
  assert.equal(entries.at(-1), complete, "buffer-upload complete event must be terminal");
  assert(Number.isInteger(complete.slot) && complete.slot > 0, "buffer-upload complete slot is invalid");
  assert.equal(complete.exactChunkCount, plan.chunkCount, "buffer-upload complete chunk count changed");
  assert.equal(complete.payloadSha256, plan.finalPayloadSha256, "buffer-upload complete payload hash changed");
  assert.equal(complete.rawSha256, plan.finalRawSha256, "buffer-upload complete raw hash changed");
  assert.equal(complete.controllerProgramDeployed, undefined, "buffer-upload complete schema unexpectedly changed");
  assert.equal(complete.controllerProgramAbsent, true, "buffer-upload did not finish with the controller Program absent");
  assert.equal(complete.controllerProgramdataAbsent, true, "buffer-upload did not finish with ProgramData absent");
  return complete;
}

async function loadBufferUploadEvidence(runDir, artifact) {
  const planPath = path.join(runDir, BUFFER_UPLOAD_PLAN_FILE);
  const { raw: planRaw, value: plan } = await readExactJson(planPath, BUFFER_UPLOAD_PLAN_KEYS, "controller buffer-upload plan");
  const { operationId: storedOperationId, ...material } = plan;
  assert.equal(operationId(material), storedOperationId, "controller buffer-upload operation ID changed");
  assert.equal(plan.schema, BUFFER_UPLOAD_PLAN_SCHEMA);
  assert.equal(plan.genesisHash, EXPECTED_GENESIS);
  assert.equal(plan.commitment, "finalized");
  assert.equal(plan.rpcSelection, "state");
  assert.equal(plan.controllerProgram, CONTROLLER_PROGRAM.toBase58());
  assert.equal(plan.controllerProgramdata, CONTROLLER_PROGRAMDATA.toBase58());
  assert.equal(plan.buffer, BUFFER.toBase58());
  assert.equal(plan.bufferAuthority, INITIALIZER.toBase58());
  assert.equal(plan.feePayer, FEE_PAYER.toBase58());
  assert.equal(plan.loader, LOADER.toBase58());
  assert.equal(plan.artifactBytes, ARTIFACT_BYTES);
  assert.equal(plan.artifactSha256, ARTIFACT_SHA256);
  assert.equal(plan.bufferRawBytes, BUFFER_BYTES);
  assert.equal(plan.bufferLamports, BUFFER_LAMPORTS);
  assert.equal(
    plan.bufferRentMinimumLamports,
    BUFFER_RENT_MINIMUM_LAMPORTS,
    "completed upload plan Buffer minimum rent changed",
  );
  assert(plan.bufferLamports >= plan.bufferRentMinimumLamports, "completed upload Buffer was below rent minimum");
  assert.equal(plan.finalPayloadSha256, ARTIFACT_SHA256);
  assert.equal(plan.finalRawSha256, sha256Hex(expectedBufferBytes(artifact)), "controller buffer-upload final raw hash changed");
  assert.equal(plan.mainnetAllowed, false);
  assert(Number.isInteger(plan.chunkSize) && plan.chunkSize > 0);
  assert.equal(plan.chunkCount, Math.ceil(ARTIFACT_BYTES / plan.chunkSize));
  assert.equal(plan.finalChunkBytes, ARTIFACT_BYTES % plan.chunkSize);

  const uploadToolPath = path.join(path.dirname(fileURLToPath(import.meta.url)), BUFFER_UPLOAD_TOOL_FILE);
  const uploadToolSha256 = sha256Hex(await readFile(uploadToolPath));
  assert.equal(uploadToolSha256, BUFFER_UPLOAD_TOOL_SHA256, "reviewed controller buffer-upload tool changed");

  const journalPath = await requireSecureRegularFile(path.join(runDir, BUFFER_UPLOAD_JOURNAL_FILE), "controller buffer-upload journal");
  const journalRaw = await readFile(journalPath);
  const chain = parseHashChainedLines(journalRaw, plan.operationId, ALLOWED_UPLOAD_JOURNAL_EVENTS, "controller buffer-upload journal");
  const complete = validateUploadCompletion(chain.entries, artifact, plan);
  return {
    complete,
    journalEntryCount: chain.entries.length,
    journalSha256: sha256Hex(journalRaw),
    journalTerminalEntrySha256: chain.terminalEntrySha256,
    operationId: plan.operationId,
    plan,
    planSha256: sha256Hex(planRaw),
    toolSha256: uploadToolSha256,
  };
}

async function baseContext() {
  const { rpcSelection, stateRpcOrigin, stateRpcUrl } = await loadDevnetRpcConfiguration();
  assert.equal(rpcSelection, "state", "controller deployment requires the default Devnet state RPC");
  const runDir = await requireSecureDirectory(requiredEnvironment("AMEBA_CEREMONY_RUN_DIR"), "ceremony run directory");
  const artifactValue = await loadArtifact(runDir);
  const bufferUpload = await loadBufferUploadEvidence(runDir, artifactValue.artifact);
  const [derivedProgramdata] = PublicKey.findProgramAddressSync([CONTROLLER_PROGRAM.toBuffer()], LOADER);
  assert(derivedProgramdata.equals(CONTROLLER_PROGRAMDATA), "controller ProgramData derivation changed");
  const toolSha256 = sha256Hex(await readFile(fileURLToPath(import.meta.url)));
  const connection = new Connection(stateRpcUrl, {
    commitment: "finalized",
    confirmTransactionInitialTimeout: 60_000,
    disableRetryOnRateLimit: true,
  });
  return {
    artifact: artifactValue.artifact,
    artifactPath: artifactValue.file,
    bufferUpload,
    connection,
    rpcProviderOriginSha256: rpcProviderOriginSha256(stateRpcOrigin),
    rpcSelection,
    runDir,
    toolSha256,
  };
}

function isRateLimit(error) {
  return /(?:\b429\b|too many requests|rate.?limit)/iu.test(String(error?.message ?? error));
}

function providerRetryAfterMs(error) {
  const message = String(error?.message ?? error);
  const milliseconds = /(?:retry(?:ing)?(?:-|\s*)after|retry-after)[^0-9]{0,16}([0-9]+)\s*ms/iu.exec(message);
  if (milliseconds) return Number(milliseconds[1]);
  const seconds = /(?:retry(?:ing)?(?:-|\s*)after|retry-after)[^0-9]{0,16}([0-9]+)\s*(?:s|sec|seconds?)/iu.exec(message);
  return seconds ? Number(seconds[1]) * 1_000 : null;
}

function exponentialBackoffMs(attempt) {
  assert(Number.isInteger(attempt) && attempt > 0, "rate-limit attempt is invalid");
  return Math.min(MAX_RATE_LIMIT_BACKOFF_MS, INITIAL_RATE_LIMIT_BACKOFF_MS * (2 ** (attempt - 1)));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchGraph(connection, callRpc, minContextSlot) {
  const options = { commitment: "finalized" };
  if (minContextSlot !== undefined) options.minContextSlot = minContextSlot;
  const response = await callRpc("controller-account-graph", () => connection.getMultipleAccountsInfoAndContext(
    [CONTROLLER_PROGRAM, CONTROLLER_PROGRAMDATA, BUFFER, FEE_PAYER],
    options,
  ));
  if (minContextSlot !== undefined) {
    assert(response.context.slot >= minContextSlot, "controller graph observation predates its required context");
  }
  const payer = response.value[3];
  assert(payer, "fee payer account is absent");
  assert(payer.owner.equals(SystemProgram.programId), "fee payer owner changed");
  assert.equal(payer.executable, false, "fee payer became executable");
  assert.equal(payer.data.length, 0, "fee payer data changed");
  return {
    buffer: response.value[2],
    payerLamports: payer.lamports,
    program: response.value[0],
    programdata: response.value[1],
    slot: response.context.slot,
  };
}

function assertExactPrestate(graph, artifact, expectedPayerLamports) {
  assert.equal(graph.program, null, "controller Program address is occupied");
  assert.equal(graph.programdata, null, "controller ProgramData address is occupied");
  const buffer = graph.buffer;
  assert(buffer, "exact controller deploy Buffer is absent");
  assert(buffer.owner.equals(LOADER), "controller deploy Buffer owner changed");
  assert.equal(buffer.executable, false, "controller deploy Buffer became executable");
  assert.equal(buffer.lamports, BUFFER_LAMPORTS, "controller deploy Buffer lamports changed");
  const expectedRaw = expectedBufferBytes(artifact);
  assert.equal(buffer.data.length, expectedRaw.length, "controller deploy Buffer length changed");
  assert(Buffer.from(buffer.data).equals(expectedRaw), "controller deploy Buffer bytes differ from the exact artifact");
  if (expectedPayerLamports !== undefined) {
    assert.equal(graph.payerLamports, expectedPayerLamports, "fee payer balance changed after deployment planning");
  }
  return {
    observedSlot: graph.slot,
    programAbsent: true,
    programdataAbsent: true,
    bufferOwner: buffer.owner.toBase58(),
    bufferExecutable: buffer.executable,
    bufferLamports: buffer.lamports,
    bufferRawBytes: buffer.data.length,
    bufferRawSha256: sha256Hex(buffer.data),
    bufferPayloadSha256: sha256Hex(buffer.data.subarray(BUFFER_HEADER_BYTES)),
    bufferAuthority: new PublicKey(buffer.data.subarray(5, BUFFER_HEADER_BYTES)).toBase58(),
    feePayerLamports: graph.payerLamports,
  };
}

function assertExactPoststate(graph, artifact, landedSlot, expectedProgramRentLamports, expectedProgramdataRentLamports) {
  assert.equal(graph.buffer, null, "consumed controller deploy Buffer still exists");
  const program = graph.program;
  const programdata = graph.programdata;
  assert(program, "controller Program is absent after finalized deployment");
  assert(programdata, "controller ProgramData is absent after finalized deployment");
  assert(program.owner.equals(LOADER), "controller Program owner changed");
  assert(programdata.owner.equals(LOADER), "controller ProgramData owner changed");
  assert.equal(program.executable, true, "controller Program is not executable");
  assert.equal(programdata.executable, false, "controller ProgramData is executable");
  assert.equal(program.lamports, expectedProgramRentLamports, "controller Program lamports changed");
  assert.equal(programdata.lamports, expectedProgramdataRentLamports, "controller ProgramData lamports changed");
  const expectedProgram = expectedProgramBytes();
  const expectedProgramdata = expectedProgramdataBytes(landedSlot, artifact);
  assert(Buffer.from(program.data).equals(expectedProgram), "controller Program raw bytes changed");
  assert(Buffer.from(programdata.data).equals(expectedProgramdata), "controller ProgramData raw bytes differ from the exact artifact and authority");
  return {
    observedSlot: graph.slot,
    bufferAbsent: true,
    program: {
      owner: program.owner.toBase58(),
      executable: program.executable,
      lamports: program.lamports,
      rawBytes: program.data.length,
      rawSha256: sha256Hex(program.data),
      linkedProgramdata: new PublicKey(program.data.subarray(4, 36)).toBase58(),
    },
    programdata: {
      owner: programdata.owner.toBase58(),
      executable: programdata.executable,
      lamports: programdata.lamports,
      rawBytes: programdata.data.length,
      rawSha256: sha256Hex(programdata.data),
      deployedSlot: Number(programdata.data.readBigUInt64LE(4)),
      upgradeAuthority: new PublicKey(programdata.data.subarray(13, 45)).toBase58(),
      payloadBytes: programdata.data.length - PROGRAMDATA_HEADER_BYTES,
      payloadSha256: sha256Hex(programdata.data.subarray(PROGRAMDATA_HEADER_BYTES)),
      capacity: programdata.data.length - PROGRAMDATA_HEADER_BYTES,
      zeroTailBytes: 0,
    },
    feePayerLamports: graph.payerLamports,
  };
}

function graphClass(graph, artifact, plan) {
  if (graph.program === null && graph.programdata === null && graph.buffer !== null) {
    assertExactPrestate(graph, artifact, plan?.prestate?.feePayerLamports);
    return "predeploy";
  }
  if (graph.program !== null && graph.programdata !== null && graph.buffer === null) return "postdeploy";
  throw new Error("controller deployment account graph is neither the exact atomic prestate nor a complete poststate");
}

async function rentAndBlockhash(connection, callRpc, uploadPlan) {
  const programRentLamports = await callRpc(
    "program-rent",
    () => connection.getMinimumBalanceForRentExemption(PROGRAM_BYTES, "finalized"),
  );
  const programdataRentLamports = await callRpc(
    "programdata-rent",
    () => connection.getMinimumBalanceForRentExemption(PROGRAMDATA_BYTES, "finalized"),
  );
  const bufferRentLamports = await callRpc(
    "buffer-rent",
    () => connection.getMinimumBalanceForRentExemption(BUFFER_BYTES, "finalized"),
  );
  const latest = await callRpc("latest-blockhash", () => connection.getLatestBlockhash("finalized"));
  assertExactRentBinding({
    bufferRentMinimumLamports: bufferRentLamports,
    programdataRentMinimumLamports: programdataRentLamports,
    uploadPlanBufferRentMinimumLamports: uploadPlan.bufferRentMinimumLamports,
    actualBufferLamports: uploadPlan.bufferLamports,
  });
  return { bufferRentLamports, latest, programRentLamports, programdataRentLamports };
}

function assertPlanShape(plan) {
  assertExactKeys(plan, PLAN_KEYS, "controller final-deploy plan");
  assertExactKeys(plan.cluster, ["commitment", "genesisHash", "observedSlot", "planValidUntilSlot", "rpcProviderOriginSha256", "rpcSelection"], "controller final-deploy cluster plan");
  assertExactKeys(plan.controller, ["buffer", "bufferAuthority", "canonicalProgramdata", "feePayer", "initialUpgradeAuthority", "loader", "programId"], "controller final-deploy identities");
  assertExactKeys(plan.source, ["cargoLockSha256", "commit", "repository", "tree"], "controller final-deploy source");
  assertExactKeys(plan.artifact, ["bytes", "programdataCapacity", "sbpfArchitecture", "sha256"], "controller final-deploy artifact");
  assertExactKeys(plan.bufferUpload, ["completeSlot", "journalEntryCount", "journalSha256", "journalTerminalEntrySha256", "operationId", "planSha256", "toolSha256"], "controller final-deploy buffer-upload evidence");
  assertExactKeys(plan.loaderEncoding, ["deployDataHex", "interfaceChecksum", "interfaceCrate", "interfaceInstructionSourceSha256", "interfaceVersion", "processorCrate", "processorSourceSha256", "processorVersion"], "controller final-deploy loader encoding");
  assertExactKeys(plan.prestate, ["bufferAuthority", "bufferExecutable", "bufferLamports", "bufferOwner", "bufferPayloadSha256", "bufferRawBytes", "bufferRawSha256", "feePayerLamports", "observedSlot", "programAbsent", "programdataAbsent"], "controller final-deploy prestate");
  assertExactKeys(plan.funding, ["bufferRentLamports", "estimatedFeeLamports", "fundingMarginLamports", "minimumPayerLamports", "payerPostBeforeFeeLamports", "programRentLamports", "programdataRentLamports"], "controller final-deploy funding");
  assertExactKeys(plan.actionManifest, ["instructionCount", "instructions", "schema", "signerOrder"], "controller final-deploy action");
  assertExactKeys(plan.planningTransaction, ["blockhash", "lastValidBlockHeight", "messageSha256", "packetBytes", "signerOrder"], "controller final-deploy planning transaction");
  assertExactKeys(plan.expectedPoststate, ["bufferAbsent", "programExecutable", "programOwner", "programRawBytes", "programRawSha256", "programdataAuthority", "programdataCapacity", "programdataExecutable", "programdataOwner", "programdataPayloadSha256", "programdataRawBytes", "programdataSlotSource", "zeroTailBytes"], "controller final-deploy expected poststate");
}

function assertDeploymentManifestShape(manifest) {
  assertExactKeys(manifest, DEPLOYMENT_MANIFEST_KEYS, "controller deployment manifest");
  assertExactKeys(manifest.cluster, ["commitment", "genesisHash", "rpcProviderOriginSha256", "rpcSelection"], "controller deployment manifest cluster");
  assertExactKeys(manifest.source, ["cargoLockSha256", "commit", "repository", "tree"], "controller deployment manifest source");
  assertExactKeys(manifest.build, ["artifactBytes", "artifactSha256", "exactProgramdataCapacity", "sbpfArchitecture"], "controller deployment manifest build");
  assertExactKeys(manifest.bufferUpload, ["completeSlot", "journalEntryCount", "journalSha256", "journalTerminalEntrySha256", "operationId", "planSha256", "toolSha256"], "controller deployment manifest buffer upload");
  assertExactKeys(manifest.loader, ["deployWithMaxDataLenHex", "interfaceChecksum", "interfaceCrate", "interfaceInstructionSourceSha256", "interfaceVersion", "processorCrate", "processorSourceSha256", "processorVersion", "programId"], "controller deployment manifest loader");
  assertExactKeys(manifest.deployment, ["blockTime", "computeUnits", "feeLamports", "messageSha256", "siblingInstructionCount", "signature", "signerOrder", "slot", "topLevelInstructionCount", "topLevelInstructions", "wireBytes", "wireSha256"], "controller deployment manifest transaction");
  assertExactKeys(manifest.funding, ["bufferPostLamports", "bufferPreLamports", "payerPostLamports", "payerPreLamports", "programRentLamports", "programdataRentLamports"], "controller deployment manifest funding");
  assertExactKeys(manifest.controller, ["bufferAbsent", "consumedBuffer", "immutable", "initialUpgradeAuthority", "initialized", "program", "programdata", "programdataState", "programId"], "controller deployment manifest controller");
  assertExactKeys(manifest.controller.program, ["executable", "lamports", "linkedProgramdata", "owner", "rawBytes", "rawSha256"], "controller deployment manifest Program");
  assertExactKeys(manifest.controller.programdataState, ["capacity", "deployedSlot", "executable", "lamports", "owner", "payloadBytes", "payloadSha256", "rawBytes", "rawSha256", "upgradeAuthority", "zeroTailBytes"], "controller deployment manifest ProgramData");
  assertExactKeys(manifest.evidence, ["deploymentAttemptCount", "finalizedEntrySha256", "journalEntriesThroughPoststate", "journalPathBasename", "journalPoststateEntrySha256", "journalThroughPoststateSha256", "planOperationId", "planPathBasename", "planSha256", "toolSha256"], "controller deployment manifest evidence");
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

async function writeOrVerifyExactJson(file, value, label) {
  const expected = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    const handle = await open(file, "wx", 0o600);
    try {
      await handle.writeFile(expected);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(file, 0o600);
    return expected;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await readFile(await requireSecureRegularFile(file, label));
    assert(existing.equals(expected), `${label} exists with different bytes`);
    return existing;
  }
}

async function recordPlanRateLimit(runDir, stage, error) {
  const prior = await readPlanRateLimits(runDir);
  const providerDelayMs = providerRetryAfterMs(error);
  const attempt = prior.length + 1;
  const appliedBackoffMs = Math.max(providerDelayMs ?? 0, exponentialBackoffMs(attempt));
  const value = {
    schema: "ameba-controller-final-deploy-plan-rate-limit-v1",
    timestamp: new Date().toISOString(),
    stage,
    providerRetryAfterMs: providerDelayMs,
    appliedBackoffMs,
    nextAttemptNotBefore: new Date(Date.now() + appliedBackoffMs).toISOString(),
    errorSha256: sha256Hex(Buffer.from(String(error?.message ?? error), "utf8")),
  };
  const file = path.join(runDir, `controller-final-deploy-plan-rate-limit-${Date.now()}-${process.pid}.json`);
  await writeExclusiveJsonDurable(file, value);
  throw new RateLimitExit("Devnet RPC rate limit encountered while planning", value);
}

async function readPlanRateLimits(runDir) {
  const names = (await readdir(runDir))
    .filter((name) => /^controller-final-deploy-plan-rate-limit-[0-9]+(?:-[0-9]+)?\.json$/u.test(name))
    .sort();
  const values = [];
  for (const name of names) {
    const file = await requireSecureRegularFile(path.join(runDir, name), "controller final-deploy plan rate-limit evidence");
    const raw = await readFile(file);
    const value = JSON.parse(raw.toString("utf8"));
    assertExactKeys(value, [
      "appliedBackoffMs",
      "errorSha256",
      "nextAttemptNotBefore",
      "providerRetryAfterMs",
      "schema",
      "stage",
      "timestamp",
    ], "controller final-deploy plan rate-limit evidence");
    assert.equal(value.schema, "ameba-controller-final-deploy-plan-rate-limit-v1");
    assert(typeof value.stage === "string" && value.stage.length > 0, "plan rate-limit stage is absent");
    assert(typeof value.timestamp === "string" && new Date(value.timestamp).toISOString() === value.timestamp, "plan rate-limit timestamp is invalid");
    assert(typeof value.nextAttemptNotBefore === "string" && new Date(value.nextAttemptNotBefore).toISOString() === value.nextAttemptNotBefore, "plan retry-not-before is invalid");
    assert(Number.isSafeInteger(value.appliedBackoffMs) && value.appliedBackoffMs >= INITIAL_RATE_LIMIT_BACKOFF_MS, "plan rate-limit backoff is invalid");
    assert(value.providerRetryAfterMs === null || (Number.isSafeInteger(value.providerRetryAfterMs) && value.providerRetryAfterMs >= 0), "plan provider retry delay is invalid");
    assert.match(value.errorSha256, /^[0-9a-f]{64}$/u, "plan rate-limit error hash is invalid");
    assert(raw.equals(Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8")), "plan rate-limit evidence is not canonical JSON");
    values.push(value);
  }
  return values;
}

async function enforcePlanBackoff(runDir) {
  const values = await readPlanRateLimits(runDir);
  if (values.length === 0) return;
  const last = values.reduce((selected, value) => (
    Date.parse(value.nextAttemptNotBefore) > Date.parse(selected.nextAttemptNotBefore) ? value : selected
  ));
  const remainingMs = Date.parse(last.nextAttemptNotBefore) - Date.now();
  if (remainingMs > 0) {
    throw new RateLimitExit("recorded Devnet planning backoff is still active", {
      appliedBackoffMs: last.appliedBackoffMs,
      nextAttemptNotBefore: last.nextAttemptNotBefore,
      remainingMs,
    });
  }
}

async function pathExists(file) {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function deploymentJournalBasename(operationIdValue) {
  assert(/^[0-9a-f]{64}$/u.test(operationIdValue), "controller final-deploy journal operation ID is invalid");
  return `controller-final-deploy-journal-v1-${operationIdValue}.jsonl`;
}

function assertJournalAllowsPlanSwitch(entries, label) {
  assert(Array.isArray(entries), `${label} entries are invalid`);
  for (const rateLimit of entries.filter((entry) => entry.event === "rate-limited")) {
    assert(
      typeof rateLimit.nextAttemptNotBefore === "string"
        && Number.isFinite(Date.parse(rateLimit.nextAttemptNotBefore)),
      `${label} rate-limit deadline is invalid`,
    );
    assert(
      Date.now() >= Date.parse(rateLimit.nextAttemptNotBefore),
      `refusing to switch plans while ${label} backoff remains active`,
    );
  }
  assert(
    !entries.some((entry) => ["finalized", "poststate-verified", "manifest-written", "complete"].includes(entry.event)),
    `refusing to replan after ${label} recorded a finalized deployment`,
  );
  for (const prepared of entries.filter((entry) => entry.event === "prepared")) {
    const terminal = entries.find((entry) => (
      entry.sequence > prepared.sequence
      && entry.signature === prepared.signature
      && ["expired-unaccepted", "transaction-failed"].includes(entry.event)
    ));
    assert(
      terminal,
      `refusing to switch plans while ${label} retains unresolved prepared signature ${String(prepared.signature)}`,
    );
  }
}

async function assertPriorDeploymentJournalsAllowReplan(runDir, excludedBasename = null) {
  assert(
    excludedBasename === null || JOURNAL_FILE_PATTERN.test(excludedBasename),
    "excluded controller final-deploy journal filename is invalid",
  );
  const names = (await readdir(runDir))
    .filter((name) => JOURNAL_FILE_PATTERN.test(name) && name !== excludedBasename)
    .sort();
  for (const name of names) {
    const match = JOURNAL_FILE_PATTERN.exec(name);
    assert(match, "controller final-deploy journal filename is invalid");
    const file = await requireSecureRegularFile(path.join(runDir, name), "prior controller final-deploy journal");
    const raw = await readFile(file);
    if (raw.length === 0) {
      assertJournalAllowsPlanSwitch([], name);
      continue;
    }
    const firstNewline = raw.indexOf(0x0a);
    assert(firstNewline > 0, `${name} is empty or has a partial first entry`);
    const first = JSON.parse(raw.subarray(0, firstNewline).toString("utf8"));
    assert(first && typeof first.operationId === "string" && /^[0-9a-f]{64}$/u.test(first.operationId), `${name} operation ID is invalid`);
    if (match[1] !== undefined) assert.equal(match[1], first.operationId, `${name} filename operation ID changed`);
    const parsed = parseHashChainedLines(raw, first.operationId, ALLOWED_DEPLOY_JOURNAL_EVENTS, name);
    assertJournalAllowsPlanSwitch(parsed.entries, name);
  }
}

async function writeNonOverwritingPlan(runDir, plan) {
  const existingNames = (await readdir(runDir)).filter((name) => PLAN_FILE_PATTERN.test(name)).sort();
  const expectedRaw = Buffer.from(`${JSON.stringify(plan, null, 2)}\n`, "utf8");
  if (existingNames.length === 0) {
    const canonicalPath = path.join(runDir, PLAN_FILE);
    await writeExclusiveJsonDurable(canonicalPath, plan);
    return canonicalPath;
  }
  let identicalPath = null;
  for (const name of existingNames) {
    const priorPath = path.join(runDir, name);
    const prior = await readExactJson(priorPath, PLAN_KEYS, "prior controller final-deploy plan");
    if (prior.raw.equals(expectedRaw)) {
      assert.equal(identicalPath, null, "duplicate identical controller final-deploy plans exist");
      identicalPath = priorPath;
      continue;
    }
    assertPlanShape(prior.value);
    const { operationId: priorOperationId, ...priorMaterial } = prior.value;
    assert.equal(operationId(priorMaterial), priorOperationId, "prior controller final-deploy plan operation ID changed");
    const nameMatch = PLAN_FILE_PATTERN.exec(name);
    if (nameMatch[1] !== undefined) assert.equal(nameMatch[1], priorOperationId, "prior replan filename operation ID changed");
    assert(
      plan.cluster.observedSlot > prior.value.cluster.planValidUntilSlot,
      `refusing to replan while ${name} remains valid`,
    );
  }
  if (identicalPath !== null) return identicalPath;
  await assertPriorDeploymentJournalsAllowReplan(runDir);
  const replanPath = path.join(runDir, `controller-final-deploy-plan-v1-${plan.operationId}.json`);
  if (await pathExists(replanPath)) {
    const existing = await readExactJson(replanPath, PLAN_KEYS, "existing controller final-deploy replan");
    assert(existing.raw.equals(expectedRaw), "existing controller final-deploy replan differs");
    return replanPath;
  }
  await writeExclusiveJsonDurable(replanPath, plan);
  return replanPath;
}

async function planDeploymentLocked(value) {
  setSafeDiagnosticStage("plan-backoff");
  await enforcePlanBackoff(value.runDir);
  const callRpc = async (stage, callback) => {
    setSafeDiagnosticStage(`rpc-${stage}`);
    try {
      return await callback();
    } catch (error) {
      if (!isRateLimit(error)) throw error;
      return recordPlanRateLimit(value.runDir, stage, error);
    }
  };
  assert.equal(await callRpc("genesis", () => value.connection.getGenesisHash()), EXPECTED_GENESIS, "state RPC genesis changed");
  setSafeDiagnosticStage("plan-prestate");
  const graph = await fetchGraph(value.connection, callRpc);
  const prestate = assertExactPrestate(graph, value.artifact);
  setSafeDiagnosticStage("plan-rent-binding");
  const rent = await rentAndBlockhash(value.connection, callRpc, value.bufferUpload.plan);
  const planning = unsignedPlanningTransaction(rent.latest.blockhash, rent.programRentLamports);
  const feeResponse = await callRpc(
    "planning-fee",
    () => value.connection.getFeeForMessage(planning.message, "finalized"),
  );
  const estimatedFeeLamports = feeResponse.value;
  setSafeDiagnosticStage("plan-funding");
  assert(Number.isSafeInteger(estimatedFeeLamports) && estimatedFeeLamports > 0, "deployment fee estimate is absent");
  assert(estimatedFeeLamports <= MAX_FEE_LAMPORTS, "deployment fee estimate exceeds the reviewed ceiling");
  const programdataShortfall = Math.max(0, rent.programdataRentLamports - BUFFER_LAMPORTS);
  const minimumPayerLamports = rent.programRentLamports + programdataShortfall + estimatedFeeLamports + FUNDING_MARGIN_LAMPORTS;
  assert(prestate.feePayerLamports >= minimumPayerLamports, "fee payer cannot cover exact deployment funding plus margin");
  const payerPostBeforeFeeLamports = prestate.feePayerLamports + BUFFER_LAMPORTS
    - rent.programRentLamports - rent.programdataRentLamports;
  assert(Number.isSafeInteger(payerPostBeforeFeeLamports) && payerPostBeforeFeeLamports >= 0, "expected fee-payer post-balance is invalid");
  const actionManifest = createActionManifest(rent.programRentLamports);
  const expectedProgram = expectedProgramBytes();
  const material = {
    schema: PLAN_SCHEMA,
    toolSha256: value.toolSha256,
    cluster: {
      genesisHash: EXPECTED_GENESIS,
      commitment: "finalized",
      rpcSelection: value.rpcSelection,
      rpcProviderOriginSha256: value.rpcProviderOriginSha256,
      observedSlot: graph.slot,
      planValidUntilSlot: graph.slot + PLAN_VALIDITY_SLOTS,
    },
    controller: {
      programId: CONTROLLER_PROGRAM.toBase58(),
      canonicalProgramdata: CONTROLLER_PROGRAMDATA.toBase58(),
      buffer: BUFFER.toBase58(),
      bufferAuthority: INITIALIZER.toBase58(),
      initialUpgradeAuthority: INITIALIZER.toBase58(),
      feePayer: FEE_PAYER.toBase58(),
      loader: LOADER.toBase58(),
    },
    source: {
      repository: SOURCE_REPOSITORY,
      commit: SOURCE_COMMIT,
      tree: SOURCE_TREE,
      cargoLockSha256: SOURCE_CARGO_LOCK_SHA256,
    },
    artifact: {
      bytes: ARTIFACT_BYTES,
      sha256: ARTIFACT_SHA256,
      sbpfArchitecture: SBPF_ARCHITECTURE,
      programdataCapacity: ARTIFACT_BYTES,
    },
    bufferUpload: {
      operationId: value.bufferUpload.operationId,
      planSha256: value.bufferUpload.planSha256,
      journalSha256: value.bufferUpload.journalSha256,
      journalTerminalEntrySha256: value.bufferUpload.journalTerminalEntrySha256,
      journalEntryCount: value.bufferUpload.journalEntryCount,
      completeSlot: value.bufferUpload.complete.slot,
      toolSha256: value.bufferUpload.toolSha256,
    },
    loaderEncoding: {
      interfaceCrate: LOADER_INTERFACE_CRATE,
      interfaceVersion: LOADER_INTERFACE_VERSION,
      interfaceChecksum: LOADER_INTERFACE_CHECKSUM,
      interfaceInstructionSourceSha256: LOADER_INTERFACE_INSTRUCTION_SOURCE_SHA256,
      processorCrate: LOADER_PROCESSOR_CRATE,
      processorVersion: LOADER_PROCESSOR_VERSION,
      processorSourceSha256: LOADER_PROCESSOR_SOURCE_SHA256,
      deployDataHex: DEPLOY_DATA_GOLDEN_HEX,
    },
    prestate,
    funding: {
      programRentLamports: rent.programRentLamports,
      programdataRentLamports: rent.programdataRentLamports,
      bufferRentLamports: rent.bufferRentLamports,
      estimatedFeeLamports,
      fundingMarginLamports: FUNDING_MARGIN_LAMPORTS,
      minimumPayerLamports,
      payerPostBeforeFeeLamports,
    },
    actionManifest,
    planningTransaction: {
      blockhash: rent.latest.blockhash,
      lastValidBlockHeight: rent.latest.lastValidBlockHeight,
      messageSha256: planning.messageSha256,
      packetBytes: planning.packetBytes,
      signerOrder: planning.signerOrder,
    },
    expectedPoststate: {
      bufferAbsent: true,
      programOwner: LOADER.toBase58(),
      programExecutable: true,
      programRawBytes: PROGRAM_BYTES,
      programRawSha256: sha256Hex(expectedProgram),
      programdataOwner: LOADER.toBase58(),
      programdataExecutable: false,
      programdataRawBytes: PROGRAMDATA_BYTES,
      programdataCapacity: ARTIFACT_BYTES,
      programdataAuthority: INITIALIZER.toBase58(),
      programdataPayloadSha256: ARTIFACT_SHA256,
      programdataSlotSource: "finalized-deployment-transaction-slot",
      zeroTailBytes: 0,
    },
    mainnetAllowed: false,
  };
  const plan = { ...material, operationId: operationId(material) };
  assertPlanShape(plan);
  setSafeDiagnosticStage("plan-write");
  const planPath = await writeNonOverwritingPlan(value.runDir, plan);
  console.log(JSON.stringify({
    operationId: plan.operationId,
    controllerProgram: plan.controller.programId,
    instructionCount: plan.actionManifest.instructionCount,
    packetBytes: plan.planningTransaction.packetBytes,
    planValidUntilSlot: plan.cluster.planValidUntilSlot,
    planFile: path.basename(planPath),
  }));
}

async function planDeployment() {
  setSafeDiagnosticStage("base-context");
  const value = await baseContext();
  const lockOperationId = operationId({
    schema: "ameba-controller-final-deploy-planning-lock-v1",
    controllerProgram: CONTROLLER_PROGRAM.toBase58(),
    artifactSha256: ARTIFACT_SHA256,
    rpcProviderOriginSha256: value.rpcProviderOriginSha256,
  });
  return withExecutionLock(
    value.runDir,
    CEREMONY_RPC_OWNER_LOCK,
    lockOperationId,
    () => planDeploymentLocked(value),
  );
}

function isPinnedPreparedRecoveryPlan(plan, planPathBasename, planSha256) {
  return plan.operationId === PINNED_PREPARED_RECOVERY.operationId
    && planPathBasename === `controller-final-deploy-plan-v1-${PINNED_PREPARED_RECOVERY.operationId}.json`
    && planSha256 === PINNED_PREPARED_RECOVERY.planSha256
    && plan.toolSha256 === PINNED_PREPARED_RECOVERY.supersededToolSha256;
}

async function readDeploymentPlan(value) {
  const configured = process.env.AMEBA_CONTROLLER_FINAL_DEPLOY_PLAN;
  const planInput = configured === undefined
    ? path.join(value.runDir, PLAN_FILE)
    : await secureFileInside(value.runDir, configured, "controller final-deploy plan");
  const planPathBasename = path.basename(planInput);
  const planName = PLAN_FILE_PATTERN.exec(planPathBasename);
  assert(planName, "controller final-deploy plan filename is invalid");
  const { raw, value: plan } = await readExactJson(
    planInput,
    PLAN_KEYS,
    "controller final-deploy plan",
  );
  assertPlanShape(plan);
  const { operationId: storedOperationId, ...material } = plan;
  assert.equal(operationId(material), storedOperationId, "controller final-deploy operation ID changed");
  assert.equal(plan.schema, PLAN_SCHEMA);
  const planSha256 = sha256Hex(raw);
  const pinnedPreparedRecovery = isPinnedPreparedRecoveryPlan(
    plan,
    planPathBasename,
    planSha256,
  );
  assert(
    plan.toolSha256 === value.toolSha256 || pinnedPreparedRecovery,
    "controller final-deploy tool changed after planning",
  );
  assert.equal(plan.cluster.genesisHash, EXPECTED_GENESIS);
  assert.equal(plan.cluster.commitment, "finalized");
  assert.equal(plan.cluster.rpcSelection, value.rpcSelection);
  assert.equal(plan.cluster.rpcProviderOriginSha256, value.rpcProviderOriginSha256);
  assert.equal(
    plan.cluster.planValidUntilSlot,
    plan.cluster.observedSlot + PLAN_VALIDITY_SLOTS,
    "controller final-deploy plan validity window changed",
  );
  assert.equal(plan.controller.programId, CONTROLLER_PROGRAM.toBase58());
  assert.equal(plan.controller.canonicalProgramdata, CONTROLLER_PROGRAMDATA.toBase58());
  assert.equal(plan.controller.buffer, BUFFER.toBase58());
  assert.equal(plan.controller.bufferAuthority, INITIALIZER.toBase58());
  assert.equal(plan.controller.initialUpgradeAuthority, INITIALIZER.toBase58());
  assert.equal(plan.controller.feePayer, FEE_PAYER.toBase58());
  assert.equal(plan.controller.loader, LOADER.toBase58());
  assert.deepEqual(plan.source, {
    repository: SOURCE_REPOSITORY,
    commit: SOURCE_COMMIT,
    tree: SOURCE_TREE,
    cargoLockSha256: SOURCE_CARGO_LOCK_SHA256,
  });
  assert.deepEqual(plan.artifact, {
    bytes: ARTIFACT_BYTES,
    sha256: ARTIFACT_SHA256,
    sbpfArchitecture: SBPF_ARCHITECTURE,
    programdataCapacity: ARTIFACT_BYTES,
  });
  assert.equal(plan.bufferUpload.operationId, value.bufferUpload.operationId);
  assert.equal(plan.bufferUpload.planSha256, value.bufferUpload.planSha256);
  assert.equal(plan.bufferUpload.journalSha256, value.bufferUpload.journalSha256);
  assert.equal(plan.bufferUpload.journalTerminalEntrySha256, value.bufferUpload.journalTerminalEntrySha256);
  assert.equal(plan.bufferUpload.journalEntryCount, value.bufferUpload.journalEntryCount);
  assert.equal(plan.bufferUpload.completeSlot, value.bufferUpload.complete.slot);
  assert.equal(plan.bufferUpload.toolSha256, value.bufferUpload.toolSha256);
  assertExactRentBinding({
    bufferRentMinimumLamports: plan.funding.bufferRentLamports,
    programdataRentMinimumLamports: plan.funding.programdataRentLamports,
    uploadPlanBufferRentMinimumLamports: value.bufferUpload.plan.bufferRentMinimumLamports,
    actualBufferLamports: plan.prestate.bufferLamports,
  });
  assert.equal(plan.prestate.bufferLamports, value.bufferUpload.plan.bufferLamports, "deployment plan Buffer balance changed from upload evidence");
  assert.deepEqual(plan.loaderEncoding, {
    interfaceCrate: LOADER_INTERFACE_CRATE,
    interfaceVersion: LOADER_INTERFACE_VERSION,
    interfaceChecksum: LOADER_INTERFACE_CHECKSUM,
    interfaceInstructionSourceSha256: LOADER_INTERFACE_INSTRUCTION_SOURCE_SHA256,
    processorCrate: LOADER_PROCESSOR_CRATE,
    processorVersion: LOADER_PROCESSOR_VERSION,
    processorSourceSha256: LOADER_PROCESSOR_SOURCE_SHA256,
    deployDataHex: DEPLOY_DATA_GOLDEN_HEX,
  });
  assert.deepEqual(plan.actionManifest, createActionManifest(plan.funding.programRentLamports), "controller final-deploy action changed");
  const planning = unsignedPlanningTransaction(plan.planningTransaction.blockhash, plan.funding.programRentLamports);
  assert.equal(planning.messageSha256, plan.planningTransaction.messageSha256, "planning message changed");
  assert.equal(planning.packetBytes, plan.planningTransaction.packetBytes, "planning packet size changed");
  assert.deepEqual(planning.signerOrder, plan.planningTransaction.signerOrder, "planning signer order changed");
  assert.equal(plan.expectedPoststate.programRawSha256, sha256Hex(expectedProgramBytes()));
  assert.equal(plan.expectedPoststate.programdataPayloadSha256, ARTIFACT_SHA256);
  assert.equal(plan.expectedPoststate.zeroTailBytes, 0);
  assert.equal(plan.mainnetAllowed, false);
  if (planName[1] !== undefined) assert.equal(planName[1], plan.operationId, "replan filename operation ID changed");
  return { pinnedPreparedRecovery, plan, planPathBasename, planRaw: raw, planSha256 };
}

async function openDeployJournal(runDir, operationIdValue) {
  const journalBasename = deploymentJournalBasename(operationIdValue);
  await assertPriorDeploymentJournalsAllowReplan(runDir, journalBasename);
  const file = path.join(runDir, journalBasename);
  let text = "";
  let handle;
  try {
    handle = await open(file, "wx+", 0o600);
    await handle.sync();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const secureFile = await requireSecureRegularFile(file, "controller final-deploy journal");
    const before = await lstat(secureFile);
    text = await readFile(secureFile, "utf8");
    handle = await open(secureFile, "a+");
    const after = await handle.stat();
    assert.equal(after.dev, before.dev, "controller final-deploy journal device changed");
    assert.equal(after.ino, before.ino, "controller final-deploy journal inode changed");
  }
  const status = await handle.stat();
  assert(status.isFile(), "controller final-deploy journal must be a regular file");
  if (typeof process.getuid === "function") assert.equal(status.uid, process.getuid(), "controller final-deploy journal owner changed");
  assert.equal(status.mode & 0o077, 0, "controller final-deploy journal permissions changed");
  const parsed = text.length === 0
    ? { entries: [], terminalEntrySha256: ZERO_HASH }
    : parseHashChainedLines(Buffer.from(text, "utf8"), operationIdValue, ALLOWED_DEPLOY_JOURNAL_EVENTS, "controller final-deploy journal");
  let previousEntrySha256 = parsed.terminalEntrySha256;
  return {
    entries: parsed.entries,
    file,
    get terminalEntrySha256() { return previousEntrySha256; },
    async append(event, fields = {}) {
      assert(ALLOWED_DEPLOY_JOURNAL_EVENTS.has(event), `unsupported controller final-deploy journal event ${event}`);
      const material = {
        sequence: parsed.entries.length + 1,
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
      parsed.entries.push(entry);
      previousEntrySha256 = entry.entrySha256;
      return entry;
    },
    async close() { await handle.close(); },
  };
}

function validatePreparedDeployment(entry, plan) {
  assert(Number.isInteger(entry.attempt) && entry.attempt > 0, "deployment prepared attempt is invalid");
  assert(typeof entry.wireBase64 === "string" && entry.wireBase64.length > 0, "deployment prepared wire bytes are absent");
  const wire = Buffer.from(entry.wireBase64, "base64");
  assert.equal(wire.toString("base64"), entry.wireBase64, "deployment prepared wire encoding changed");
  assert.equal(wire.length, entry.wireBytes, "deployment prepared wire length changed");
  assert.equal(sha256Hex(wire), entry.wireSha256, "deployment prepared wire hash changed");
  assert(wire.length <= MAX_PACKET_BYTES, "deployment prepared packet exceeds the packet limit");
  const transaction = Transaction.from(wire);
  assert(transaction.verifySignatures(), "deployment prepared transaction signatures are invalid");
  assert.equal(transaction.recentBlockhash, entry.blockhash, "deployment prepared blockhash changed");
  assertExactPreparedMessage(transaction, entry, plan);
  assert.equal(bs58.encode(transaction.signature), entry.signature, "deployment prepared fee-payer signature changed");
  assert.deepEqual(
    transaction.signatures.map((signature) => signature.publicKey.toBase58()),
    plan.actionManifest.signerOrder,
    "deployment prepared signer order changed",
  );
  assert.equal(entry.actionManifestSha256, sha256Hex(Buffer.from(JSON.stringify(plan.actionManifest), "utf8")), "deployment prepared action commitment changed");
  assert(Number.isSafeInteger(entry.lastValidBlockHeight) && entry.lastValidBlockHeight > 0, "deployment prepared last-valid block height is invalid");
  assert(Number.isInteger(entry.preflightSlot) && entry.preflightSlot >= plan.prestate.observedSlot, "deployment prepared preflight slot is invalid");
  assert(entry.preflightSlot <= plan.cluster.planValidUntilSlot, "deployment prepared transaction was signed after plan expiry");
  assertExactKeys(entry.signerProvider, ["providerId", "providerKind", "providerModuleSha256"], "deployment signer-provider evidence");
  assert(typeof entry.signerProvider.providerId === "string" && entry.signerProvider.providerId.length > 0, "deployment signer-provider ID is absent");
  assert(["hardware-wallet", "kms", "smart-account", "wallet"].includes(entry.signerProvider.providerKind), "deployment signer-provider kind is unsupported");
  assert.match(entry.signerProvider.providerModuleSha256, /^[0-9a-f]{64}$/u, "deployment signer-provider module hash is invalid");
  return { entry, transaction, wire };
}

function replayDeployJournal(entries, plan) {
  const attempts = [];
  const bySignature = new Map();
  let poststate = null;
  let manifestWritten = null;
  let complete = null;
  for (const entry of entries) {
    if (entry.event === "prepared") {
      assert.equal(entry.attempt, attempts.length + 1, "deployment attempt sequence changed");
      if (attempts.length > 0) {
        const prior = attempts.at(-1);
        assert(prior.expired && !prior.finalized && !prior.failed, "new deployment attempt followed a nonexpired attempt");
      }
      const prepared = validatePreparedDeployment(entry, plan);
      assert(!bySignature.has(entry.signature), "deployment prepared signature is duplicated");
      const attempt = {
        ...prepared,
        expired: false,
        failed: false,
        finalized: false,
        simulationFailed: false,
        simulationPassed: false,
        submitted: false,
        sendCount: 0,
        lastSendAcknowledged: false,
        lastSendEvent: null,
        lastSendContextSlot: prepared.entry.preflightSlot,
      };
      attempts.push(attempt);
      bySignature.set(entry.signature, attempt);
      continue;
    }
    if ([
      "expired-unaccepted",
      "finalized",
      "resubmit-prepared",
      "resubmitted",
      "send-prepared",
      "simulation-failed",
      "simulation-passed",
      "submission-unknown",
      "submitted",
      "transaction-failed",
    ].includes(entry.event)) {
      const attempt = bySignature.get(entry.signature);
      assert(attempt, `${entry.event} refers to an unknown deployment signature`);
      if (["send-prepared", "resubmit-prepared"].includes(entry.event)) {
        const expectedSendEvent = attempt.sendCount === 0 ? "send-prepared" : "resubmit-prepared";
        assert.equal(entry.event, expectedSendEvent, `${entry.event} has incorrect first-send/resubmission attribution`);
        assert.equal(entry.messageSha256, attempt.entry.messageSha256, `${entry.event} message hash changed`);
        assert.equal(entry.wireSha256, attempt.entry.wireSha256, `${entry.event} wire hash changed`);
        assert(Number.isSafeInteger(entry.minContextSlot) && entry.minContextSlot >= attempt.lastSendContextSlot, `${entry.event} context regressed`);
        attempt.lastSendContextSlot = entry.minContextSlot;
        attempt.sendCount += 1;
        attempt.lastSendAcknowledged = false;
        attempt.lastSendEvent = entry.event;
      }
      if (entry.event === "simulation-passed") attempt.simulationPassed = true;
      if (entry.event === "simulation-failed") {
        assert(!attempt.finalized && !attempt.expired && !attempt.failed, "deployment simulation failed after the attempt was terminal");
        attempt.simulationFailed = true;
        attempt.failed = true;
      }
      if (["submitted", "resubmitted", "submission-unknown"].includes(entry.event)) {
        assert(attempt.lastSendEvent, `${entry.event} lacks preceding send evidence`);
        assert.equal(attempt.lastSendAcknowledged, false, `${entry.event} duplicates a send outcome`);
        if (entry.event === "submitted") assert.equal(attempt.lastSendEvent, "send-prepared", "submitted follows a resubmission");
        if (entry.event === "resubmitted") assert.equal(attempt.lastSendEvent, "resubmit-prepared", "resubmitted follows a first send");
        attempt.lastSendAcknowledged = true;
        attempt.submitted = true;
      }
      if (entry.event === "expired-unaccepted") {
        assert(!attempt.expired && !attempt.failed && !attempt.finalized, "deployment expiry followed a terminal attempt state");
        assert(Number.isSafeInteger(entry.observedBlockHeight) && entry.observedBlockHeight > attempt.entry.lastValidBlockHeight, "deployment expiry block height is invalid");
        assert(Number.isSafeInteger(entry.finalizedProofSlot) && entry.finalizedProofSlot > 0, "deployment expiry finalized proof slot is invalid");
        assert(Number.isSafeInteger(entry.prestateProofSlot) && entry.prestateProofSlot >= entry.finalizedProofSlot, "deployment expiry prestate proof predates finalized context");
        attempt.expired = true;
      }
      if (entry.event === "transaction-failed") {
        assert(!attempt.expired && !attempt.failed && !attempt.finalized, "deployment failure followed a terminal attempt state");
        attempt.failed = true;
      }
      if (entry.event === "finalized") {
        assert(!attempt.expired && !attempt.failed && !attempt.finalized, "deployment finalization followed a terminal attempt state");
        assert.equal(entry.messageSha256, attempt.entry.messageSha256, "deployment finalized message hash changed");
        assert.equal(entry.wireSha256, attempt.entry.wireSha256, "deployment finalized wire hash changed");
        assert(Number.isSafeInteger(entry.slot) && entry.slot > 0, "deployment finalized slot is invalid");
        assert(entry.blockTime === null || Number.isSafeInteger(entry.blockTime), "deployment finalized block time is invalid");
        assert(Number.isSafeInteger(entry.feeLamports) && entry.feeLamports > 0 && entry.feeLamports <= MAX_FEE_LAMPORTS, "deployment finalized fee is invalid");
        assert(entry.computeUnits === null || (Number.isSafeInteger(entry.computeUnits) && entry.computeUnits > 0), "deployment finalized compute usage is invalid");
        assert.equal(entry.payerPreLamports, plan.prestate.feePayerLamports, "deployment finalized payer pre-balance changed");
        assert.equal(entry.payerPostLamports, plan.funding.payerPostBeforeFeeLamports - entry.feeLamports, "deployment finalized payer post-balance changed");
        assert.equal(entry.programPostLamports, plan.funding.programRentLamports, "deployment finalized Program balance changed");
        assert.equal(entry.programdataPostLamports, plan.funding.programdataRentLamports, "deployment finalized ProgramData balance changed");
        assert.equal(entry.bufferPreLamports, BUFFER_LAMPORTS, "deployment finalized Buffer pre-balance changed");
        assert.equal(entry.bufferPostLamports, 0, "deployment finalized Buffer post-balance changed");
        attempt.finalized = true;
        attempt.finalizedEntry = entry;
      }
      continue;
    }
    if (entry.event === "poststate-verified") {
      const attempt = bySignature.get(entry.signature);
      assert(attempt?.finalized, "deployment poststate refers to a nonfinalized attempt");
      assert.equal(poststate, null, "deployment poststate was recorded twice");
      assert.equal(entry.deploymentSlot, attempt.finalizedEntry.slot, "deployment poststate slot changed");
      assert(Number.isSafeInteger(entry.deploymentSlot) && entry.deploymentSlot > 0, "deployment poststate deployment slot is invalid");
      assert(Number.isSafeInteger(entry.observationSlot) && entry.observationSlot >= entry.deploymentSlot, "deployment poststate observation slot is invalid");
      assert.equal(entry.programRawSha256, plan.expectedPoststate.programRawSha256, "deployment poststate Program hash changed");
      assert.match(entry.programdataRawSha256, /^[0-9a-f]{64}$/u, "deployment poststate ProgramData hash is invalid");
      assert.equal(entry.payloadSha256, ARTIFACT_SHA256, "deployment poststate payload hash changed");
      assert.equal(entry.programdataAuthority, INITIALIZER.toBase58(), "deployment poststate authority changed");
      assert.equal(entry.capacity, ARTIFACT_BYTES, "deployment poststate capacity changed");
      assert.equal(entry.bufferAbsent, true, "deployment poststate retained the consumed Buffer");
      poststate = entry;
    }
    if (entry.event === "manifest-written") {
      assert(poststate, "deployment manifest was recorded before exact poststate verification");
      assert.equal(manifestWritten, null, "deployment manifest was recorded twice");
      assert.equal(entry.signature, poststate.signature, "deployment manifest signature changed");
      assert.equal(entry.manifestFile, DEPLOYMENT_MANIFEST_FILE, "deployment manifest filename changed");
      assert.match(entry.manifestSha256, /^[0-9a-f]{64}$/u, "deployment manifest SHA-256 is invalid");
      manifestWritten = entry;
    }
    if (entry.event === "complete") {
      assert.equal(complete, null, "deployment complete was recorded twice");
      assert(manifestWritten, "deployment completed before its manifest was recorded");
      assert.equal(entry.signature, manifestWritten.signature, "deployment complete signature changed");
      assert.equal(entry.slot, poststate.deploymentSlot, "deployment complete slot changed");
      assert.equal(entry.controllerProgram, CONTROLLER_PROGRAM.toBase58(), "deployment complete Program changed");
      assert.equal(entry.controllerProgramdata, CONTROLLER_PROGRAMDATA.toBase58(), "deployment complete ProgramData changed");
      assert.equal(entry.artifactSha256, ARTIFACT_SHA256, "deployment complete artifact hash changed");
      assert.equal(entry.manifestSha256, manifestWritten.manifestSha256, "deployment complete manifest hash changed");
      assert.equal(entry.controllerInitialized, false, "deployment complete incorrectly claims initialization");
      assert.equal(entry.controllerImmutable, false, "deployment complete incorrectly claims immutability");
      complete = entry;
    }
  }
  assert(attempts.filter((attempt) => attempt.finalized).length <= 1, "multiple deployment attempts finalized");
  for (const attempt of attempts) {
    assert(!(attempt.expired && attempt.finalized), "deployment attempt is both expired and finalized");
    assert(!(attempt.failed && attempt.finalized), "deployment attempt is both failed and finalized");
    assert(!(attempt.failed && attempt.expired), "deployment attempt is both failed and expired");
  }
  if (manifestWritten) assert(poststate, "deployment manifest lacks verified poststate");
  if (complete) assert(manifestWritten, "deployment completed without a recorded manifest");
  const active = attempts.length === 0 ? null : attempts.at(-1);
  return { active, attempts, complete, manifestWritten, poststate };
}

function assertPinnedPreparedRecoveryJournal(planValue, replay, entries) {
  if (!planValue.pinnedPreparedRecovery) return;
  assert.equal(planValue.plan.operationId, PINNED_PREPARED_RECOVERY.operationId, "pinned recovery operation changed");
  assert.equal(planValue.planSha256, PINNED_PREPARED_RECOVERY.planSha256, "pinned recovery plan changed");
  assert(entries.length >= 3, "pinned recovery journal lacks its immutable prepared prefix");
  assert.equal(entries[0].entrySha256, PINNED_PREPARED_RECOVERY.sessionEntrySha256, "pinned recovery session entry changed");
  assert.equal(entries[1].entrySha256, PINNED_PREPARED_RECOVERY.decodedActionEntrySha256, "pinned recovery decoded action changed");
  assert.equal(entries[2].entrySha256, PINNED_PREPARED_RECOVERY.preparedEntrySha256, "pinned recovery prepared entry changed");
  assert.equal(replay.attempts.length, 1, "pinned recovery must never create a second prepared attempt");
  const entry = replay.attempts[0].entry;
  assert.equal(entry.attempt, 1, "pinned recovery attempt number changed");
  assert.equal(entry.signature, PINNED_PREPARED_RECOVERY.signature, "pinned recovery signature changed");
  assert.equal(entry.blockhash, PINNED_PREPARED_RECOVERY.blockhash, "pinned recovery blockhash changed");
  assert.equal(entry.lastValidBlockHeight, PINNED_PREPARED_RECOVERY.lastValidBlockHeight, "pinned recovery blockhash lifetime changed");
  assert.equal(entry.preflightSlot, PINNED_PREPARED_RECOVERY.preflightSlot, "pinned recovery preflight slot changed");
  assert.equal(entry.signerProvider.providerId, PINNED_PREPARED_RECOVERY.providerId, "pinned recovery signer provider changed");
  assert.equal(entry.signerProvider.providerKind, "wallet", "pinned recovery signer-provider kind changed");
  assert.equal(entry.signerProvider.providerModuleSha256, PINNED_PREPARED_RECOVERY.providerModuleSha256, "pinned recovery signer-provider module changed");
  assert.equal(entry.actionManifestSha256, PINNED_PREPARED_RECOVERY.actionManifestSha256, "pinned recovery action commitment changed");
  assert.equal(entry.messageSha256, PINNED_PREPARED_RECOVERY.messageSha256, "pinned recovery message commitment changed");
  assert.equal(entry.wireSha256, PINNED_PREPARED_RECOVERY.wireSha256, "pinned recovery wire commitment changed");
  assert.equal(entry.wireBytes, PINNED_PREPARED_RECOVERY.wireBytes, "pinned recovery wire length changed");
}

async function recordRateLimit(journal, stage, error, fields = {}) {
  const attempt = journal.entries.filter((entry) => entry.event === "rate-limited").length + 1;
  const providerDelayMs = providerRetryAfterMs(error);
  const appliedBackoffMs = Math.max(providerDelayMs ?? 0, exponentialBackoffMs(attempt));
  const nextAttemptNotBefore = new Date(Date.now() + appliedBackoffMs).toISOString();
  await journal.append("rate-limited", {
    stage,
    attempt,
    providerRetryAfterMs: providerDelayMs,
    appliedBackoffMs,
    nextAttemptNotBefore,
    ...fields,
    errorSha256: sha256Hex(Buffer.from(String(error?.message ?? error), "utf8")),
  });
  throw new RateLimitExit("Devnet RPC rate limit encountered", { attempt, appliedBackoffMs, nextAttemptNotBefore });
}

async function enforceRecordedBackoff(journal) {
  const rateLimits = journal.entries.filter((entry) => entry.event === "rate-limited");
  if (rateLimits.length === 0) return;
  const last = rateLimits.at(-1);
  const remainingMs = Date.parse(last.nextAttemptNotBefore) - Date.now();
  if (remainingMs > 0) {
    throw new RateLimitExit("recorded Devnet RPC backoff is still active", {
      attempt: rateLimits.length,
      appliedBackoffMs: last.appliedBackoffMs,
      nextAttemptNotBefore: last.nextAttemptNotBefore,
    });
  }
}

async function executeRpc(journal, stage, callback, fields = {}) {
  try {
    return await callback();
  } catch (error) {
    if (!isRateLimit(error)) throw error;
    return recordRateLimit(journal, stage, error, fields);
  }
}

async function prepareSignedDeployment(plan, latest, signerProvider, preflightSlot) {
  const unsignedTransaction = new Transaction({ feePayer: FEE_PAYER, recentBlockhash: latest.blockhash });
  unsignedTransaction.add(...createDeploymentInstructions(plan.funding.programRentLamports));
  const signed = await signTransactionWithProvider({
    providerValue: signerProvider,
    transaction: unsignedTransaction,
    expectedSigners: [FEE_PAYER, CONTROLLER_PROGRAM, INITIALIZER],
    operationId: plan.operationId,
    stage: "controller-final-deploy",
  });
  const transaction = signed.transaction;
  const wire = Buffer.from(transaction.serialize({ requireAllSignatures: true, verifySignatures: true }));
  assert(wire.length <= MAX_PACKET_BYTES, "signed deployment transaction exceeds the packet limit");
  assert(transaction.signature, "signed deployment transaction lacks a fee-payer signature");
  const entry = {
    attempt: 0,
    signature: bs58.encode(transaction.signature),
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
    preflightSlot,
    signerProvider: signed.providerEvidence,
    actionManifestSha256: sha256Hex(Buffer.from(JSON.stringify(plan.actionManifest), "utf8")),
    messageSha256: sha256Hex(transaction.serializeMessage()),
    wireSha256: sha256Hex(wire),
    wireBytes: wire.length,
    wireBase64: wire.toString("base64"),
  };
  return { entry, transaction, wire };
}

async function simulatePrepared(value, plan, journal, attempt) {
  const versioned = VersionedTransaction.deserialize(attempt.wire);
  let response;
  try {
    response = await executeRpc(
      journal,
      "simulate-deployment",
      () => value.connection.simulateTransaction(versioned, {
        commitment: "processed",
        sigVerify: true,
        replaceRecentBlockhash: false,
        minContextSlot: attempt.entry.preflightSlot,
      }),
      { signature: attempt.entry.signature },
    );
  } catch (error) {
    if (error instanceof RateLimitExit) throw error;
    await journal.append("simulation-failed", {
      signature: attempt.entry.signature,
      errorSha256: sha256Hex(Buffer.from(String(error?.message ?? error), "utf8")),
    });
    throw error;
  }
  if (response.value.err !== null) {
    await journal.append("simulation-failed", {
      signature: attempt.entry.signature,
      errorSha256: sha256Hex(Buffer.from(JSON.stringify(response.value.err), "utf8")),
      logsSha256: sha256Hex(Buffer.from(JSON.stringify(response.value.logs ?? []), "utf8")),
      simulationSlot: response.context.slot,
    });
    throw new Error("controller deployment simulation failed");
  }
  await journal.append("simulation-passed", {
    signature: attempt.entry.signature,
    simulationSlot: response.context.slot,
    unitsConsumed: response.value.unitsConsumed ?? null,
    logsSha256: sha256Hex(Buffer.from(JSON.stringify(response.value.logs ?? []), "utf8")),
  });
  attempt.simulationPassed = true;
}

async function exactPresubmit(value, plan, journal, minimumContextSlot = plan.prestate.observedSlot) {
  assert(Number.isSafeInteger(minimumContextSlot) && minimumContextSlot >= plan.prestate.observedSlot, "deployment minimum context slot is invalid");
  assert.equal(await executeRpc(journal, "pre-submit-genesis", () => value.connection.getGenesisHash()), EXPECTED_GENESIS, "state RPC genesis changed before submission");
  const graph = await fetchGraph(value.connection, (stage, callback) => executeRpc(journal, `pre-submit-${stage}`, callback), minimumContextSlot);
  assertExactPrestate(graph, value.artifact, plan.prestate.feePayerLamports);
  assert(graph.slot <= plan.cluster.planValidUntilSlot, "controller final-deploy plan expired before submission");
  const programRentLamports = await executeRpc(
    journal,
    "pre-submit-program-rent",
    () => value.connection.getMinimumBalanceForRentExemption(PROGRAM_BYTES, "finalized"),
  );
  const programdataRentLamports = await executeRpc(
    journal,
    "pre-submit-programdata-rent",
    () => value.connection.getMinimumBalanceForRentExemption(PROGRAMDATA_BYTES, "finalized"),
  );
  const bufferRentLamports = await executeRpc(
    journal,
    "pre-submit-buffer-rent",
    () => value.connection.getMinimumBalanceForRentExemption(BUFFER_BYTES, "finalized"),
  );
  assert.equal(programRentLamports, plan.funding.programRentLamports, "Program rent changed after planning");
  assert.equal(programdataRentLamports, plan.funding.programdataRentLamports, "ProgramData rent changed after planning");
  assert.equal(bufferRentLamports, plan.funding.bufferRentLamports, "Buffer rent changed after planning");
  return graph;
}

function deploymentSendEvents(entries, signature) {
  const priorSendCount = entries.filter(
    (entry) => entry.signature === signature
      && ["send-prepared", "resubmit-prepared"].includes(entry.event),
  ).length;
  return priorSendCount === 0
    ? { before: "send-prepared", after: "submitted" }
    : { before: "resubmit-prepared", after: "resubmitted" };
}

async function submitPrepared(value, plan, journal, attempt) {
  const priorContextSlots = journal.entries
    .filter((entry) => entry.signature === attempt.entry.signature && ["send-prepared", "resubmit-prepared"].includes(entry.event))
    .map((entry) => entry.minContextSlot);
  const requiredContextSlot = Math.max(attempt.entry.preflightSlot, ...priorContextSlots);
  const graph = await exactPresubmit(value, plan, journal, requiredContextSlot);
  const blockhashValidity = await executeRpc(
    journal,
    "pre-submit-blockhash-validity",
    () => value.connection.isBlockhashValid(attempt.entry.blockhash, {
      commitment: "finalized",
      minContextSlot: graph.slot,
    }),
    { signature: attempt.entry.signature },
  );
  assert(blockhashValidity.context.slot >= graph.slot, "deployment blockhash validation predates presubmit state");
  assert.equal(blockhashValidity.value, true, "deployment blockhash expired before submission");
  const sendEvents = deploymentSendEvents(journal.entries, attempt.entry.signature);
  await journal.append(sendEvents.before, {
    signature: attempt.entry.signature,
    messageSha256: attempt.entry.messageSha256,
    wireSha256: attempt.entry.wireSha256,
    wireBytes: attempt.entry.wireBytes,
    minContextSlot: graph.slot,
  });
  let returnedSignature;
  try {
    returnedSignature = await value.connection.sendRawTransaction(attempt.wire, {
      skipPreflight: false,
      preflightCommitment: "processed",
      maxRetries: 0,
      minContextSlot: graph.slot,
    });
  } catch (error) {
    if (isRateLimit(error)) {
      return recordRateLimit(journal, "submit-deployment", error, { signature: attempt.entry.signature });
    }
    await journal.append("submission-unknown", {
      signature: attempt.entry.signature,
      errorSha256: sha256Hex(Buffer.from(String(error?.message ?? error), "utf8")),
    });
    throw new Error("controller deployment submission outcome is unknown; rerun the same armed plan for reconciliation");
  }
  assert.equal(returnedSignature, attempt.entry.signature, "state RPC returned a different deployment signature");
  await journal.append(sendEvents.after, {
    signature: attempt.entry.signature,
  });
  attempt.submitted = true;
}

function transactionAccountKeys(landed) {
  const resolved = landed.transaction.message.getAccountKeys();
  const keys = resolved.staticAccountKeys ?? resolved.accountKeys ?? resolved;
  assert(Array.isArray(keys), "finalized deployment account keys are unavailable");
  return keys;
}

function indexOfKey(keys, expected, label) {
  const index = keys.findIndex((key) => key.equals(expected));
  assert(index >= 0, `${label} is absent from the finalized deployment transaction`);
  assert.equal(keys.filter((key) => key.equals(expected)).length, 1, `${label} is duplicated in the finalized deployment transaction`);
  return index;
}

async function fetchFinalizedAttempt(value, journal, attempt) {
  return executeRpc(
    journal,
    "fetch-finalized-deployment",
    () => value.connection.getTransaction(attempt.entry.signature, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    }),
    { signature: attempt.entry.signature },
  );
}

async function verifyFinalizedAttempt(value, plan, journal, attempt, landedInput) {
  const landed = landedInput ?? await fetchFinalizedAttempt(value, journal, attempt);
  assert(landed?.meta && landed.meta.err === null, "finalized deployment transaction is absent or failed");
  assert.equal(landed.transaction.signatures[0], attempt.entry.signature, "finalized deployment fee-payer signature changed");
  const landedMessage = Buffer.from(landed.transaction.message.serialize());
  assert.equal(sha256Hex(landedMessage), attempt.entry.messageSha256, "finalized deployment message hash changed");
  assert(landedMessage.equals(attempt.transaction.serializeMessage()), "finalized deployment message differs from the prepared message");
  assert(Number.isSafeInteger(landed.meta.fee) && landed.meta.fee > 0 && landed.meta.fee <= MAX_FEE_LAMPORTS, "finalized deployment fee is outside the reviewed ceiling");
  const keys = transactionAccountKeys(landed);
  const payerIndex = indexOfKey(keys, FEE_PAYER, "fee payer");
  const programIndex = indexOfKey(keys, CONTROLLER_PROGRAM, "controller Program");
  const programdataIndex = indexOfKey(keys, CONTROLLER_PROGRAMDATA, "controller ProgramData");
  const bufferIndex = indexOfKey(keys, BUFFER, "controller deploy Buffer");
  assert.equal(landed.meta.preBalances[payerIndex], plan.prestate.feePayerLamports, "transaction fee-payer pre-balance differs from the signed preflight");
  assert.equal(landed.meta.preBalances[programIndex], 0, "controller Program existed before the deployment transaction");
  assert.equal(landed.meta.preBalances[programdataIndex], 0, "controller ProgramData existed before the deployment transaction");
  assert.equal(landed.meta.preBalances[bufferIndex], BUFFER_LAMPORTS, "deployment Buffer pre-balance changed");
  assert.equal(landed.meta.postBalances[programIndex], plan.funding.programRentLamports, "controller Program post-balance changed");
  assert.equal(landed.meta.postBalances[programdataIndex], plan.funding.programdataRentLamports, "controller ProgramData post-balance changed");
  assert.equal(landed.meta.postBalances[bufferIndex], 0, "deployment Buffer was not fully drained");
  const expectedPayerPost = plan.funding.payerPostBeforeFeeLamports - landed.meta.fee;
  assert.equal(landed.meta.postBalances[payerIndex], expectedPayerPost, "deployment fee-payer post-balance changed");
  if (!attempt.finalized) {
    await journal.append("finalized", {
      signature: attempt.entry.signature,
      slot: landed.slot,
      blockTime: landed.blockTime,
      feeLamports: landed.meta.fee,
      computeUnits: landed.meta.computeUnitsConsumed ?? null,
      messageSha256: attempt.entry.messageSha256,
      wireSha256: attempt.entry.wireSha256,
      payerPreLamports: landed.meta.preBalances[payerIndex],
      payerPostLamports: landed.meta.postBalances[payerIndex],
      programPostLamports: landed.meta.postBalances[programIndex],
      programdataPostLamports: landed.meta.postBalances[programdataIndex],
      bufferPreLamports: landed.meta.preBalances[bufferIndex],
      bufferPostLamports: landed.meta.postBalances[bufferIndex],
    });
    attempt.finalized = true;
  }
  return {
    blockTime: landed.blockTime,
    computeUnits: landed.meta.computeUnitsConsumed ?? null,
    feeLamports: landed.meta.fee,
    payerPostLamports: landed.meta.postBalances[payerIndex],
    slot: landed.slot,
  };
}

async function findExactLandedAttempt(value, plan, journal, attempts) {
  const landedAttempts = [];
  for (const attempt of attempts) {
    const landed = await fetchFinalizedAttempt(value, journal, attempt);
    if (landed === null) continue;
    const finalized = await verifyFinalizedAttempt(value, plan, journal, attempt, landed);
    landedAttempts.push({ attempt, finalized });
  }
  assert(landedAttempts.length <= 1, "more than one exact controller deployment attempt landed");
  return landedAttempts[0] ?? null;
}

async function proveExpiredUnaccepted(value, plan, journal, replay, attempt, observedBlockHeight) {
  assert(observedBlockHeight > attempt.entry.lastValidBlockHeight, "deployment expiry proof precedes blockhash expiry");
  const statuses = await executeRpc(
    journal,
    "expiry-signature-status-recheck",
    () => value.connection.getSignatureStatuses([attempt.entry.signature], { searchTransactionHistory: true }),
    { signature: attempt.entry.signature },
  );
  assert.equal(statuses.value.length, 1, "deployment expiry status response length changed");
  const status = statuses.value[0];
  if (status?.err) throw new Error("controller deployment transaction landed with an error");
  const exactLanded = await findExactLandedAttempt(value, plan, journal, replay.attempts);
  if (exactLanded) return { expired: false, ...exactLanded };
  assert.equal(status, null, "deployment is visible but exact finalized transaction evidence is absent");
  const finalizedProofSlot = await executeRpc(
    journal,
    "expiry-finalized-slot",
    () => value.connection.getSlot("finalized"),
  );
  const graph = await fetchGraph(
    value.connection,
    (stage, callback) => executeRpc(journal, `expiry-${stage}`, callback),
    finalizedProofSlot,
  );
  assert.equal(graphClass(graph, value.artifact, plan), "predeploy", "expired unaccepted deployment changed the controller graph");
  await journal.append("expired-unaccepted", {
    signature: attempt.entry.signature,
    observedBlockHeight,
    finalizedProofSlot,
    prestateProofSlot: graph.slot,
  });
  attempt.expired = true;
  return { expired: true };
}

async function pollFinalized(value, plan, journal, replay, attempt) {
  for (;;) {
    const status = (await executeRpc(
      journal,
      "deployment-signature-status",
      () => value.connection.getSignatureStatuses([attempt.entry.signature], { searchTransactionHistory: true }),
      { signature: attempt.entry.signature },
    )).value[0];
    if (status?.err) {
      await journal.append("transaction-failed", {
        signature: attempt.entry.signature,
        errorSha256: sha256Hex(Buffer.from(JSON.stringify(status.err), "utf8")),
      });
      attempt.failed = true;
      throw new Error("controller deployment transaction finalized with an error");
    }
    if (status?.confirmationStatus === "finalized") {
      return { attempt, finalized: await verifyFinalizedAttempt(value, plan, journal, attempt) };
    }
    if (status === null) {
      const blockHeight = await executeRpc(journal, "finalized-block-height", () => value.connection.getBlockHeight("finalized"));
      if (blockHeight > attempt.entry.lastValidBlockHeight) {
        const proof = await proveExpiredUnaccepted(value, plan, journal, replay, attempt, blockHeight);
        if (proof.expired) return null;
        return { attempt: proof.attempt, finalized: proof.finalized };
      }
    }
    await delay(FINALIZED_STATUS_POLL_INTERVAL_MS);
  }
}

function journalPrefixRaw(entries, terminalSequence) {
  assert(Number.isInteger(terminalSequence) && terminalSequence > 0 && terminalSequence <= entries.length, "journal prefix terminal sequence is invalid");
  return Buffer.from(`${entries.slice(0, terminalSequence).map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
}

function buildDeploymentManifest(value, planValue, journal, replay, attempt, finalized, poststate) {
  const finalizedEntry = journal.entries.find((entry) => entry.event === "finalized" && entry.signature === attempt.entry.signature);
  const poststateEntry = journal.entries.find((entry) => entry.event === "poststate-verified" && entry.signature === attempt.entry.signature);
  assert(finalizedEntry && poststateEntry, "deployment evidence journal is incomplete");
  const journalPrefix = journalPrefixRaw(journal.entries, poststateEntry.sequence);
  const manifest = {
    schema: DEPLOYMENT_MANIFEST_SCHEMA,
    operationId: planValue.plan.operationId,
    authorizedForInitializationEvidence: true,
    mainnetAllowed: false,
    cluster: {
      genesisHash: EXPECTED_GENESIS,
      commitment: "finalized",
      rpcSelection: planValue.plan.cluster.rpcSelection,
      rpcProviderOriginSha256: planValue.plan.cluster.rpcProviderOriginSha256,
    },
    source: { ...planValue.plan.source },
    build: {
      artifactBytes: ARTIFACT_BYTES,
      artifactSha256: ARTIFACT_SHA256,
      sbpfArchitecture: SBPF_ARCHITECTURE,
      exactProgramdataCapacity: ARTIFACT_BYTES,
    },
    bufferUpload: { ...planValue.plan.bufferUpload },
    loader: {
      programId: LOADER.toBase58(),
      interfaceCrate: LOADER_INTERFACE_CRATE,
      interfaceVersion: LOADER_INTERFACE_VERSION,
      interfaceChecksum: LOADER_INTERFACE_CHECKSUM,
      interfaceInstructionSourceSha256: LOADER_INTERFACE_INSTRUCTION_SOURCE_SHA256,
      processorCrate: LOADER_PROCESSOR_CRATE,
      processorVersion: LOADER_PROCESSOR_VERSION,
      processorSourceSha256: LOADER_PROCESSOR_SOURCE_SHA256,
      deployWithMaxDataLenHex: DEPLOY_DATA_GOLDEN_HEX,
    },
    deployment: {
      signature: attempt.entry.signature,
      slot: finalized.slot,
      blockTime: finalized.blockTime,
      feeLamports: finalized.feeLamports,
      computeUnits: finalized.computeUnits,
      messageSha256: attempt.entry.messageSha256,
      wireSha256: attempt.entry.wireSha256,
      wireBytes: attempt.entry.wireBytes,
      signerOrder: [...planValue.plan.actionManifest.signerOrder],
      topLevelInstructions: planValue.plan.actionManifest.instructions,
      topLevelInstructionCount: 2,
      siblingInstructionCount: 0,
    },
    funding: {
      programRentLamports: planValue.plan.funding.programRentLamports,
      programdataRentLamports: planValue.plan.funding.programdataRentLamports,
      bufferPreLamports: BUFFER_LAMPORTS,
      bufferPostLamports: 0,
      payerPreLamports: planValue.plan.prestate.feePayerLamports,
      payerPostLamports: finalized.payerPostLamports,
    },
    controller: {
      programId: CONTROLLER_PROGRAM.toBase58(),
      programdata: CONTROLLER_PROGRAMDATA.toBase58(),
      initialUpgradeAuthority: INITIALIZER.toBase58(),
      initialized: false,
      immutable: false,
      program: poststate.program,
      programdataState: poststate.programdata,
      consumedBuffer: BUFFER.toBase58(),
      bufferAbsent: true,
    },
    evidence: {
      planSha256: planValue.planSha256,
      planOperationId: planValue.plan.operationId,
      planPathBasename: planValue.planPathBasename,
      toolSha256: value.toolSha256,
      journalPathBasename: path.basename(journal.file),
      journalThroughPoststateSha256: sha256Hex(journalPrefix),
      journalPoststateEntrySha256: poststateEntry.entrySha256,
      journalEntriesThroughPoststate: poststateEntry.sequence,
      finalizedEntrySha256: finalizedEntry.entrySha256,
      deploymentAttemptCount: replay.attempts.length,
    },
  };
  assertDeploymentManifestShape(manifest);
  return manifest;
}

async function finalizePoststate(value, planValue, journal, replay, attempt, finalizedInput) {
  const finalizedEntry = journal.entries.find((entry) => entry.event === "finalized" && entry.signature === attempt.entry.signature);
  assert(finalizedEntry, "finalized deployment journal entry is absent");
  const finalized = finalizedInput ?? {
    blockTime: finalizedEntry.blockTime,
    computeUnits: finalizedEntry.computeUnits,
    feeLamports: finalizedEntry.feeLamports,
    payerPostLamports: finalizedEntry.payerPostLamports,
    slot: finalizedEntry.slot,
  };
  const graph = await fetchGraph(
    value.connection,
    (stage, callback) => executeRpc(journal, `poststate-${stage}`, callback),
    finalized.slot,
  );
  const poststate = assertExactPoststate(
    graph,
    value.artifact,
    finalized.slot,
    planValue.plan.funding.programRentLamports,
    planValue.plan.funding.programdataRentLamports,
  );
  let poststateEntry = journal.entries.find((entry) => entry.event === "poststate-verified");
  if (!poststateEntry) {
    poststateEntry = await journal.append("poststate-verified", {
      signature: attempt.entry.signature,
      deploymentSlot: finalized.slot,
      observationSlot: poststate.observedSlot,
      programRawSha256: poststate.program.rawSha256,
      programdataRawSha256: poststate.programdata.rawSha256,
      payloadSha256: poststate.programdata.payloadSha256,
      programdataAuthority: poststate.programdata.upgradeAuthority,
      capacity: poststate.programdata.capacity,
      bufferAbsent: true,
    });
    replay.poststate = poststateEntry;
  } else {
    assert.equal(poststateEntry.signature, attempt.entry.signature, "recorded deployment poststate signature changed");
    assert.equal(poststateEntry.deploymentSlot, finalized.slot, "recorded deployment poststate slot changed");
    assert.equal(poststateEntry.programRawSha256, poststate.program.rawSha256, "recorded Program hash changed");
    assert.equal(poststateEntry.programdataRawSha256, poststate.programdata.rawSha256, "recorded ProgramData hash changed");
    assert.equal(poststateEntry.payloadSha256, ARTIFACT_SHA256, "recorded ProgramData payload hash changed");
  }

  const manifest = buildDeploymentManifest(value, planValue, journal, replay, attempt, finalized, poststate);
  const manifestPath = path.join(value.runDir, DEPLOYMENT_MANIFEST_FILE);
  const manifestRaw = await writeOrVerifyExactJson(manifestPath, manifest, "controller deployment manifest");
  const manifestSha256 = sha256Hex(manifestRaw);
  let manifestEntry = journal.entries.find((entry) => entry.event === "manifest-written");
  if (!manifestEntry) {
    manifestEntry = await journal.append("manifest-written", {
      signature: attempt.entry.signature,
      manifestFile: DEPLOYMENT_MANIFEST_FILE,
      manifestSha256,
    });
  } else {
    assert.equal(manifestEntry.signature, attempt.entry.signature, "deployment manifest journal signature changed");
    assert.equal(manifestEntry.manifestFile, DEPLOYMENT_MANIFEST_FILE, "deployment manifest filename changed");
    assert.equal(manifestEntry.manifestSha256, manifestSha256, "deployment manifest hash changed");
  }
  let complete = journal.entries.find((entry) => entry.event === "complete");
  if (!complete) {
    complete = await journal.append("complete", {
      signature: attempt.entry.signature,
      slot: finalized.slot,
      controllerProgram: CONTROLLER_PROGRAM.toBase58(),
      controllerProgramdata: CONTROLLER_PROGRAMDATA.toBase58(),
      artifactSha256: ARTIFACT_SHA256,
      manifestSha256,
      controllerInitialized: false,
      controllerImmutable: false,
    });
  }
  return { complete, manifest, manifestPath, manifestSha256, poststate };
}

async function reconcileOrSubmit(value, planValue, journal) {
  let replay = replayDeployJournal(journal.entries, planValue.plan);
  assertPinnedPreparedRecoveryJournal(planValue, replay, journal.entries);
  const graph = await fetchGraph(value.connection, (stage, callback) => executeRpc(journal, `reconcile-${stage}`, callback));
  const state = graphClass(graph, value.artifact, planValue.plan);
  if (state === "postdeploy") {
    const exactLanded = await findExactLandedAttempt(value, planValue.plan, journal, replay.attempts);
    assert(exactLanded, "controller exists without one exact landed journaled deployment transaction");
    replay = replayDeployJournal(journal.entries, planValue.plan);
    return finalizePoststate(value, planValue, journal, replay, exactLanded.attempt, exactLanded.finalized);
  }

  if (replay.complete) throw new Error("deployment journal says complete but finalized controller accounts are absent");
  if (replay.active?.failed) throw new Error("the latest controller deployment attempt failed and requires review");
  if (replay.active && !replay.active.expired && !replay.active.finalized) {
    const status = (await executeRpc(
      journal,
      "reconcile-signature-status",
      () => value.connection.getSignatureStatuses([replay.active.entry.signature], { searchTransactionHistory: true }),
      { signature: replay.active.entry.signature },
    )).value[0];
    if (status?.err) {
      await journal.append("transaction-failed", {
        signature: replay.active.entry.signature,
        errorSha256: sha256Hex(Buffer.from(JSON.stringify(status.err), "utf8")),
      });
      throw new Error("journaled controller deployment finalized with an error");
    }
    if (status?.confirmationStatus === "finalized") {
      const finalized = await verifyFinalizedAttempt(value, planValue.plan, journal, replay.active);
      replay = replayDeployJournal(journal.entries, planValue.plan);
      return finalizePoststate(value, planValue, journal, replay, replay.active, finalized);
    }
    if (status === null) {
      const blockHeight = await executeRpc(journal, "reconcile-block-height", () => value.connection.getBlockHeight("finalized"));
      if (blockHeight > replay.active.entry.lastValidBlockHeight) {
        const proof = await proveExpiredUnaccepted(
          value,
          planValue.plan,
          journal,
          replay,
          replay.active,
          blockHeight,
        );
        if (!proof.expired) {
          replay = replayDeployJournal(journal.entries, planValue.plan);
          return finalizePoststate(value, planValue, journal, replay, proof.attempt, proof.finalized);
        }
      } else {
        if (!replay.active.simulationPassed) await simulatePrepared(value, planValue.plan, journal, replay.active);
        await submitPrepared(value, planValue.plan, journal, replay.active);
        const landed = await pollFinalized(value, planValue.plan, journal, replay, replay.active);
        if (!landed) return reconcileOrSubmit(value, planValue, journal);
        replay = replayDeployJournal(journal.entries, planValue.plan);
        return finalizePoststate(value, planValue, journal, replay, landed.attempt, landed.finalized);
      }
    } else {
      const landed = await pollFinalized(value, planValue.plan, journal, replay, replay.active);
      if (!landed) return reconcileOrSubmit(value, planValue, journal);
      replay = replayDeployJournal(journal.entries, planValue.plan);
      return finalizePoststate(value, planValue, journal, replay, landed.attempt, landed.finalized);
    }
  }

  if (planValue.pinnedPreparedRecovery) {
    throw new Error("pinned prepared recovery cannot create or sign another attempt; prove the existing wire expired or replan under the current tool");
  }
  const current = await exactPresubmit(value, planValue.plan, journal);
  assert(current.slot <= planValue.plan.cluster.planValidUntilSlot, "controller final-deploy plan expired before a new attempt");
  await journal.append("decoded-action-displayed", {
    nextAttempt: replay.attempts.length + 1,
    actionManifestSha256: sha256Hex(Buffer.from(JSON.stringify(planValue.plan.actionManifest), "utf8")),
    actionManifest: planValue.plan.actionManifest,
  });
  console.log(JSON.stringify({
    armedOperationId: planValue.plan.operationId,
    decodedAction: planValue.plan.actionManifest,
  }));
  const latestResponse = await executeRpc(
    journal,
    "execution-blockhash",
    () => value.connection.getLatestBlockhashAndContext({
      commitment: "finalized",
      minContextSlot: current.slot,
    }),
  );
  assert(latestResponse.context.slot >= current.slot, "deployment blockhash context predates presign state");
  const latest = latestResponse.value;
  const preSignGraph = await fetchGraph(
    value.connection,
    (stage, callback) => executeRpc(journal, `pre-sign-${stage}`, callback),
    latestResponse.context.slot,
  );
  assertExactPrestate(preSignGraph, value.artifact, planValue.plan.prestate.feePayerLamports);
  assert(preSignGraph.slot <= planValue.plan.cluster.planValidUntilSlot, "controller final-deploy plan expired before signing");
  assert.equal(planValue.pinnedPreparedRecovery, false, "pinned prepared recovery reached signer loading");
  const signerProvider = await loadInjectedSignerProvider(value.runDir);
  const prepared = await prepareSignedDeployment(planValue.plan, latest, signerProvider, preSignGraph.slot);
  prepared.entry.attempt = replay.attempts.length + 1;
  const preparedEntry = await journal.append("prepared", prepared.entry);
  const attempt = validatePreparedDeployment(preparedEntry, planValue.plan);
  Object.assign(attempt, {
    expired: false,
    failed: false,
    finalized: false,
    simulationFailed: false,
    simulationPassed: false,
    submitted: false,
  });
  await simulatePrepared(value, planValue.plan, journal, attempt);
  await submitPrepared(value, planValue.plan, journal, attempt);
  replay.attempts.push(attempt);
  const landed = await pollFinalized(value, planValue.plan, journal, replay, attempt);
  if (!landed) return reconcileOrSubmit(value, planValue, journal);
  replay = replayDeployJournal(journal.entries, planValue.plan);
  return finalizePoststate(value, planValue, journal, replay, landed.attempt, landed.finalized);
}

async function executeDeployment(pinnedRecoveryOnly = false) {
  setSafeDiagnosticStage("execute-base-context");
  const value = await baseContext();
  const planValue = await readDeploymentPlan(value);
  assert.equal(requiredEnvironment("AMEBA_CEREMONY_ARM"), planValue.plan.operationId, "controller final deployment is not explicitly armed");
  if (pinnedRecoveryOnly) {
    assert.equal(planValue.pinnedPreparedRecovery, true, "resume-prepared accepts only the exact pinned prepared recovery plan");
    assert.equal(
      requiredEnvironment("AMEBA_CONTROLLER_FINAL_DEPLOY_PREPARED_RECOVERY"),
      PINNED_PREPARED_RECOVERY.operationId,
      "pinned prepared recovery is not explicitly armed",
    );
  } else {
    assert.equal(planValue.pinnedPreparedRecovery, false, "the superseded prepared plan requires resume-prepared mode");
  }
  await withExecutionLock(value.runDir, CEREMONY_RPC_OWNER_LOCK, planValue.plan.operationId, async () => {
    const journal = await openDeployJournal(value.runDir, planValue.plan.operationId);
    try {
      await journal.append("session-started", {
        planSha256: planValue.planSha256,
        toolSha256: value.toolSha256,
      });
      await enforceRecordedBackoff(journal);
      assert.equal(await executeRpc(journal, "genesis", () => value.connection.getGenesisHash()), EXPECTED_GENESIS, "state RPC genesis changed");
      const result = await reconcileOrSubmit(value, planValue, journal);
      console.log(JSON.stringify({
        operationId: planValue.plan.operationId,
        signature: result.complete.signature,
        slot: result.complete.slot,
        controllerProgram: CONTROLLER_PROGRAM.toBase58(),
        deploymentManifest: result.manifestPath,
        deploymentManifestSha256: result.manifestSha256,
        controllerInitialized: false,
        controllerImmutable: false,
      }));
    } finally {
      await journal.close();
    }
  });
}

async function verifyPinnedPreparedRecoveryOffline() {
  const runDir = await requireSecureDirectory(requiredEnvironment("AMEBA_CEREMONY_RUN_DIR"), "ceremony run directory");
  const planPathBasename = `controller-final-deploy-plan-v1-${PINNED_PREPARED_RECOVERY.operationId}.json`;
  const planPath = path.join(runDir, planPathBasename);
  const { raw: planRaw, value: plan } = await readExactJson(
    planPath,
    PLAN_KEYS,
    "pinned prepared recovery plan",
  );
  assertPlanShape(plan);
  const { operationId: storedOperationId, ...material } = plan;
  assert.equal(operationId(material), storedOperationId, "pinned prepared recovery operation ID changed");
  const planSha256 = sha256Hex(planRaw);
  assert.equal(
    isPinnedPreparedRecoveryPlan(plan, planPathBasename, planSha256),
    true,
    "offline input is not the exact pinned prepared recovery plan",
  );
  assert.deepEqual(
    plan.actionManifest,
    createActionManifest(plan.funding.programRentLamports),
    "pinned prepared recovery action changed",
  );
  const journalBasename = deploymentJournalBasename(PINNED_PREPARED_RECOVERY.operationId);
  const journalPath = await requireSecureRegularFile(
    path.join(runDir, journalBasename),
    "pinned prepared recovery journal",
  );
  const journalRaw = await readFile(journalPath);
  const parsed = parseHashChainedLines(
    journalRaw,
    PINNED_PREPARED_RECOVERY.operationId,
    ALLOWED_DEPLOY_JOURNAL_EVENTS,
    "pinned prepared recovery journal",
  );
  assert.equal(parsed.entries.length, 3, "offline pinned recovery verifier requires the pre-simulation three-entry journal");
  const planValue = {
    pinnedPreparedRecovery: true,
    plan,
    planPathBasename,
    planRaw,
    planSha256,
  };
  const replay = replayDeployJournal(parsed.entries, plan);
  assertPinnedPreparedRecoveryJournal(planValue, replay, parsed.entries);
  assert(replay.active, "pinned prepared recovery lacks its one active prepared attempt");
  return {
    ok: true,
    operationId: plan.operationId,
    planSha256,
    journalPathBasename: journalBasename,
    journalEntryCount: parsed.entries.length,
    preparedSignature: replay.active.entry.signature,
    messageSha256: replay.active.entry.messageSha256,
    wireSha256: replay.active.entry.wireSha256,
    wireBytes: replay.active.entry.wireBytes,
    simulationRecorded: false,
    submissionRecorded: false,
  };
}

async function main() {
  const mode = process.argv[2];
  assert.equal(process.argv.length, 3, "usage: devnet-controller-final-deploy.mjs <self-test|verify-pinned-prepared-offline|plan|execute|resume-prepared>");
  if (mode === "self-test") {
    console.log(JSON.stringify(selfTest()));
  } else if (mode === "verify-pinned-prepared-offline") {
    console.log(JSON.stringify(await verifyPinnedPreparedRecoveryOffline()));
  } else if (mode === "plan") {
    await planDeployment();
  } else if (mode === "execute") {
    await executeDeployment();
  } else if (mode === "resume-prepared") {
    await executeDeployment(true);
  } else {
    throw new Error("usage: devnet-controller-final-deploy.mjs <self-test|verify-pinned-prepared-offline|plan|execute|resume-prepared>");
  }
}

try {
  setSafeDiagnosticStage("command-dispatch");
  await main();
} catch (error) {
  const errorSha256 = sha256Hex(Buffer.from(`${error?.name ?? "Error"}:${error?.message ?? String(error)}`, "utf8"));
  const diagnostic = safeDiagnostic(error);
  console.error(JSON.stringify({
    ok: false,
    rateLimited: error instanceof RateLimitExit,
    backoff: error instanceof RateLimitExit ? error.metadata : null,
    errorSha256,
    ...(diagnostic === null ? {} : { diagnostic }),
  }));
  process.exitCode = error instanceof RateLimitExit ? 75 : 1;
}
