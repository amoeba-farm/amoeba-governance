import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import bs58Module from "bs58";
import {
  Connection,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  FINALIZED_TRANSACTION_POLL_INTERVAL_MS,
  RpcBackoffExit,
  guardRpcConnection,
  loadInjectedSignerProvider,
  openJournal,
  operationId,
  reconcileOneFinalized,
  selfTestCeremonyRuntime,
  sha256Hex,
  signTransactionWithProvider,
  submitOneFinalized,
  withCeremonyRpcOwnerLock,
  withExecutionLock,
  writeExclusiveJson,
} from "./devnet-ceremony-runtime.mjs";
import {
  loadDevnetRpcConfiguration,
  requireSecureDirectory,
  requireSecureRegularFile,
} from "./secure-rpc-env.mjs";

import {
  GateStatusV1,
} from "../dist/upgradeGovernance/release1.js";
import {
  BOOTSTRAP_ACTIVATION_RECEIPT_V1_LEN,
  CURRENT_DEPLOYMENT_STATE_V1_LEN,
  TARGET_AUTHORITY_HANDOFF_RECEIPT_V1_LEN,
  deriveBootstrapActivationReceiptPdaV1,
  deriveCurrentDeploymentStatePdaV1,
  deriveTargetAuthorityHandoffReceiptPdaV1,
  deserializeTargetAuthorityHandoffReceiptV1,
  validateTargetAuthorityHandoffReceiptDigestV1,
} from "../dist/upgradeGovernance/release1Ceremony.js";
import {
  BOOTSTRAP_ACTIVATION_PROPOSAL_V2_LEN,
  GovernanceActionKindV2,
  GovernanceLifecycleStateV2,
  GOVERNANCE_LIFECYCLE_REGISTRY_V2_LEN,
  TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_LEN,
  deriveGovernanceActionProposalPdaV2,
  deriveGovernanceLifecycleRegistryPdaV2,
  deserializeGovernanceLifecycleRegistryV2,
  deserializeTargetAuthorityHandoffProposalV2,
} from "../dist/upgradeGovernance/release1GovernanceV2.js";
import {
  BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  CONTROLLER_CONFIG_LEN,
  PROTOCOL_GATE_LEN,
  deriveAuthorityPda,
  deriveControllerConfigPda,
  deriveGatePda,
  deriveUpgradeableProgramdataAddress,
  deserializeProtocolGateV1,
} from "../dist/upgradeGovernance/v1.js";
import {
  deserializeControllerConfigV1,
} from "../dist/upgradeGovernance/v1FixedAccounts.js";

process.umask(0o077);

const bs58 = bs58Module.default ?? bs58Module;
const EXPECTED_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const BASE_DESCRIPTOR_SHA256 = "315449f8e4cdca69ca3e5ff934d24e1af029cc1578cc5d9eb01d03644d767450";
const AMENDED_DESCRIPTOR_SHA256 = "d12f0a7c0ef6d477fa49a164c093a36e181cf8a5bf14e0d762faecefb6848cd9";
const EXPECTED_CONTROLLER = "FqCshwTvCzQRZYHFiX96nwiG93xwgWRMyCj5onvoo7Lm";
const EXPECTED_CONTROLLER_PROGRAMDATA = "7CTZKJSkPG6TEbEeB6jweKCBP47GBDcwpqmL5b534jed";
const EXPECTED_TARGET = "9ipkBCjEfeJDMF6AFrezRmDDHmbnmeyv45cfXNqAnWsH";
const EXPECTED_TARGET_PROGRAMDATA = "2DBN762WGdNc85xiVdvQX7Lo4TXAq3WhVz9mBQcaU3a3";
const EXPECTED_LEGACY_AUTHORITY = "D5jhTM3kYHdKixrc52Kn657gBHytQLhQqsTmJBcNFVdq";
const EXPECTED_PAYER = "G2f6Fv477ZyFbmRFtVr21jf9VufXpiRCxf1e91J6SxxT";
const EXPECTED_TREASURY = "8XUjnzVzR71DaVuqbSHaNev5H4vrxofyFP4iZt2FXa1j";
const BUFFER_HEADER_LEN = 37;
const PROGRAM_HEADER_LEN = 36;
const PROGRAMDATA_HEADER_LEN = 45;
const LOADER_UPGRADE_DATA = Buffer.from([3, 0, 0, 0]);
const LOADER_CLOSE_DATA = Buffer.from([5, 0, 0, 0]);
const MINIMAL_PROOF_PAYLOAD = Buffer.from([1]);
const PLAN_VALIDITY_SLOTS = 10_000;
const MAX_PACKET_BYTES = 1_232;
const PLAN_SCHEMA = "ameba-governance-devnet-v2-former-authority-boundary-plan-v1";
const NEGATIVE_RECEIPT_SCHEMA = "ameba-governance-devnet-v2-former-authority-negative-proof-v1";
const CLOSE_RECEIPT_SCHEMA = "ameba-governance-devnet-v2-former-authority-proof-buffer-close-v1";
const NEGATIVE_RECEIPT_FILE = "v2-former-authority-negative-proof-v1.json";
const CLOSE_RECEIPT_FILE = "v2-former-authority-proof-buffer-close-v1.json";
const NEGATIVE_STAGE = "former-authority-negative";
const CLOSE_STAGE = "former-authority-proof-buffer-close";

const COMMANDS = new Set([
  "self-test",
  "verify-evidence-offline",
  "status",
  "plan-next",
  "execute-next",
]);

function usage() {
  return `usage: node tools/devnet-governance-v2-former-authority-proof-close.mjs <${[...COMMANDS].join("|")}>\n`;
}

function env(name) {
  const value = process.env[name]?.trim();
  assert(value, `${name} is required`);
  return value;
}

function lowerHash(value, label) {
  assert(typeof value === "string" && /^[0-9a-f]{64}$/u.test(value), `${label} must be lowercase SHA-256`);
  assert.notEqual(value, "0".repeat(64), `${label} must be nonzero`);
  return value;
}

function key(value, label) {
  assert(typeof value === "string", `${label} must be base58`);
  const result = new PublicKey(value);
  assert(!result.equals(PublicKey.default), `${label} must be nondefault`);
  return result;
}

function stable(value) {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([field, entry]) => `${JSON.stringify(field)}:${stable(entry)}`).join(",")}}`;
}

function semanticReceiptHash(domain, receipt) {
  const material = { ...receipt };
  delete material.receiptSha256;
  return createHash("sha256")
    .update(domain, "ascii")
    .update(Buffer.from([0]))
    .update(stable(material), "utf8")
    .digest("hex");
}

function instructionManifest(instruction) {
  return {
    programId: instruction.programId.toBase58(),
    accounts: instruction.keys.map((entry) => ({
      pubkey: entry.pubkey.toBase58(),
      isSigner: entry.isSigner,
      isWritable: entry.isWritable,
    })),
    dataHex: Buffer.from(instruction.data).toString("hex"),
  };
}

function accountStructural(account) {
  if (account === null) return null;
  return {
    owner: account.owner.toBase58(),
    executable: account.executable,
    dataLength: account.data.length,
    dataSha256: sha256Hex(account.data),
  };
}

function accountFull(account) {
  if (account === null) return null;
  return { ...accountStructural(account), lamports: account.lamports };
}

async function secureJsonFile(input, label) {
  const file = await requireSecureRegularFile(input, label);
  const raw = await readFile(file);
  assert(raw.length > 0, `${label} is empty`);
  return { file, raw, sha256: sha256Hex(raw), value: JSON.parse(raw.toString("utf8")) };
}

async function secureJson(environment, label) {
  return secureJsonFile(env(environment), label);
}

function validateDescriptor(descriptor) {
  assert.equal(descriptor.schema, "ameba-governance-devnet-controller-v2-descriptor-v1");
  assert.equal(descriptor.cluster?.genesisHash, EXPECTED_GENESIS);
  assert.equal(descriptor.identities?.controllerProgram, EXPECTED_CONTROLLER);
  assert.equal(descriptor.identities?.controllerProgramData, EXPECTED_CONTROLLER_PROGRAMDATA);
  assert.equal(descriptor.identities?.targetProgram, EXPECTED_TARGET);
  assert.equal(descriptor.identities?.targetProgramData, EXPECTED_TARGET_PROGRAMDATA);
  assert.equal(descriptor.identities?.legacyTargetAuthority, EXPECTED_LEGACY_AUTHORITY);
  assert.equal(descriptor.identities?.feePayer, EXPECTED_PAYER);
  assert.equal(descriptor.identities?.treasury, EXPECTED_TREASURY);
  assert.equal(descriptor.authorization?.devnetOnly, true);
  assert.equal(descriptor.authorization?.mainnetAllowed, false);
  assert.equal(descriptor.authorization?.writerRestartAllowed, false);
}

function deriveIds(descriptor, handoffFinal) {
  const controller = key(descriptor.identities.controllerProgram, "controller program");
  const controllerProgramdata = key(descriptor.identities.controllerProgramData, "controller ProgramData");
  const target = key(descriptor.identities.targetProgram, "target program");
  const targetProgramdata = key(descriptor.identities.targetProgramData, "target ProgramData");
  const legacyAuthority = key(descriptor.identities.legacyTargetAuthority, "legacy authority");
  const payer = key(descriptor.identities.feePayer, "fee payer");
  const treasury = key(descriptor.identities.treasury, "treasury");
  assert(deriveUpgradeableProgramdataAddress(controller)[0].equals(controllerProgramdata), "controller ProgramData is not canonical");
  assert(deriveUpgradeableProgramdataAddress(target)[0].equals(targetProgramdata), "target ProgramData is not canonical");
  const [config] = deriveControllerConfigPda(controller, target);
  const [authority] = deriveAuthorityPda(controller, target);
  const [gate] = deriveGatePda(controller, target);
  const [registry] = deriveGovernanceLifecycleRegistryPdaV2(controller, target);
  const [handoffReceipt] = deriveTargetAuthorityHandoffReceiptPdaV1(controller, target);
  const [activationReceipt] = deriveBootstrapActivationReceiptPdaV1(controller, target);
  const [currentDeployment] = deriveCurrentDeploymentStatePdaV1(controller, target);
  const proposalId = BigInt(handoffFinal.proposal.id);
  assert(proposalId > 0n, "handoff proposal ID is invalid");
  const [handoffProposal] = deriveGovernanceActionProposalPdaV2(controller, target, GovernanceActionKindV2.TargetAuthorityHandoff, proposalId);
  for (const [field, value] of Object.entries({
    controllerConfig: config,
    controllerAuthority: authority,
    protocolGate: gate,
    governanceLifecycleRegistryV2: registry,
  })) assert.equal(value.toBase58(), descriptor.pdas[field], `descriptor ${field} PDA changed`);
  assert.equal(handoffProposal.toBase58(), handoffFinal.proposal.address, "handoff proposal address changed");
  return {
    controller, controllerProgramdata, target, targetProgramdata, legacyAuthority, payer,
    treasury, config, authority, gate, registry, handoffReceipt, activationReceipt,
    currentDeployment, proposalId, handoffProposal,
  };
}

function expectedProofRaw(legacyAuthority) {
  const raw = Buffer.alloc(BUFFER_HEADER_LEN + MINIMAL_PROOF_PAYLOAD.length);
  raw.writeUInt32LE(1, 0);
  raw[4] = 1;
  legacyAuthority.toBuffer().copy(raw, 5);
  MINIMAL_PROOF_PAYLOAD.copy(raw, BUFFER_HEADER_LEN);
  return raw;
}

async function loadBundle() {
  const base = await secureJson("AMEBA_GOVERNANCE_V2_BASE_DESCRIPTOR", "base controller descriptor");
  const descriptor = await secureJson("AMEBA_GOVERNANCE_V2_DESCRIPTOR", "amended controller descriptor");
  assert.equal(base.sha256, BASE_DESCRIPTOR_SHA256, "base descriptor SHA-256 changed");
  assert.equal(descriptor.sha256, AMENDED_DESCRIPTOR_SHA256, "amended descriptor SHA-256 changed");
  validateDescriptor(base.value);
  validateDescriptor(descriptor.value);
  const expectedAmendment = structuredClone(base.value);
  expectedAmendment.governanceLivenessV2.initialTimingProfileHash = descriptor.value.governanceLivenessV2.initialTimingProfileHash;
  assert.deepEqual(descriptor.value, expectedAmendment, "descriptor amendment differs outside the timing-profile hash");

  const spreadRunDir = await requireSecureDirectory(env("AMEBA_SPREAD_BRIDGE_RUN_DIR"), "Spread bridge run directory");
  const runDir = await requireSecureDirectory(env("AMEBA_GOVERNANCE_V2_PROOF_CLOSE_RUN_DIR"), "former-authority proof/close run directory");
  const minimal = await secureJsonFile(path.join(spreadRunDir, "spread-former-authority-minimal-proof-buffer-receipt-v2.json"), "minimal proof-buffer receipt");
  const deploymentPlan = await secureJsonFile(path.join(spreadRunDir, "spread-reviewed-bridge-deployment-plan-v1.json"), "Spread deployment plan");
  const deploymentReceipt = await secureJsonFile(path.join(spreadRunDir, "spread-reviewed-bridge-upgrade-receipt-v1.json"), "Spread upgrade receipt");
  const handoffFinal = await secureJson("AMEBA_GOVERNANCE_V2_HANDOFF_FINAL_RECEIPT", "V2 handoff final receipt");
  const artifactFile = await requireSecureRegularFile(path.join(spreadRunDir, "light_token_minter.so"), "Spread bridge artifact");
  const artifact = await readFile(artifactFile);
  assert(artifact.length > 0, "Spread bridge artifact is empty");
  const artifactSha256 = sha256Hex(artifact);

  assert.equal(handoffFinal.value.schema, "ameba-governance-devnet-v2-handoff-activation-final-receipt-v1");
  assert.equal(handoffFinal.value.descriptorSha256, AMENDED_DESCRIPTOR_SHA256);
  assert.equal(handoffFinal.value.baseDescriptorSha256, BASE_DESCRIPTOR_SHA256);
  assert.equal(handoffFinal.value.phase, "handoff");
  assert.equal(handoffFinal.value.controllerProgram, EXPECTED_CONTROLLER);
  assert.equal(handoffFinal.value.targetProgram, EXPECTED_TARGET);
  assert.equal(handoffFinal.value.targetProgramdata, EXPECTED_TARGET_PROGRAMDATA);
  assert.equal(handoffFinal.value.targetAuthority, descriptor.value.pdas.controllerAuthority);
  assert.equal(handoffFinal.value.gateStatus, GateStatusV1.EmergencyFrozen);
  assert.equal(handoffFinal.value.activationReceiptSha256, null);
  assert.equal(handoffFinal.value.currentDeploymentSha256, null);
  assert.equal(handoffFinal.value.artifactSha256, artifactSha256);
  assert(handoffFinal.value.proposal && handoffFinal.value.proposal.state === GovernanceLifecycleStateV2.Completed, "handoff proposal is not completed");
  lowerHash(handoffFinal.value.proposal.digest, "handoff proposal digest");
  lowerHash(handoffFinal.value.handoffReceiptSha256, "handoff receipt account hash");
  const ids = deriveIds(descriptor.value, handoffFinal.value);

  const proofRaw = expectedProofRaw(ids.legacyAuthority);
  const proofPayloadSha256 = sha256Hex(MINIMAL_PROOF_PAYLOAD);
  const proofRawSha256 = sha256Hex(proofRaw);
  const minimalKeys = [
    "schema", "mainnetAllowed", "genesisHash", "targetProgram", "targetProgramData",
    "loader", "proofBuffer", "bufferAuthority", "spillTreasury", "payloadBytes",
    "payloadSha256", "bufferRawBytes", "bufferRawSha256", "bufferPayloadOffset",
    "finalizedSlot", "sourceDeploymentPlanSha256", "sourceDeploymentReceiptSha256",
    "authorityFailureProof", "loaderOrderEvidence",
  ].sort();
  assert.deepEqual(Object.keys(minimal.value).sort(), minimalKeys, "minimal proof-buffer receipt keys changed");
  assert.equal(minimal.value.schema, "ameba-spread-former-authority-minimal-proof-buffer-receipt-v2");
  assert.equal(minimal.value.mainnetAllowed, false);
  assert.equal(minimal.value.genesisHash, EXPECTED_GENESIS);
  assert.equal(minimal.value.targetProgram, EXPECTED_TARGET);
  assert.equal(minimal.value.targetProgramData, EXPECTED_TARGET_PROGRAMDATA);
  assert.equal(minimal.value.loader, BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58());
  const proofBuffer = key(minimal.value.proofBuffer, "minimal proof buffer");
  assert.equal(minimal.value.bufferAuthority, EXPECTED_LEGACY_AUTHORITY);
  assert.equal(minimal.value.spillTreasury, EXPECTED_TREASURY);
  assert.equal(minimal.value.payloadBytes, 1);
  assert.equal(minimal.value.payloadSha256, proofPayloadSha256);
  assert.equal(minimal.value.bufferRawBytes, BUFFER_HEADER_LEN + 1);
  assert.equal(minimal.value.bufferRawSha256, proofRawSha256);
  assert.equal(minimal.value.bufferPayloadOffset, BUFFER_HEADER_LEN);
  assert(Number.isSafeInteger(minimal.value.finalizedSlot) && minimal.value.finalizedSlot > 0, "minimal proof-buffer finalized slot is invalid");
  assert.deepEqual(minimal.value.authorityFailureProof, {
    expectedInstructionError: "IncorrectAuthority",
    formerAuthority: EXPECTED_LEGACY_AUTHORITY,
    handoffMustBeFinalizedBeforeSubmission: true,
    failedUpgradeMustNotConsumeBuffer: true,
  });
  assert.deepEqual(minimal.value.loaderOrderEvidence, {
    agaveVersion: "4.0.0",
    sourceCommit: "2a165e7",
    sourcePath: "programs/bpf_loader/src/lib.rs",
    sourceSha256: "ecaec5b089f0763d886be548b7d43d6c1d92d39a86dbc9190d5555ca1eead9e9",
    bufferAuthorityCheckedBeforePayloadLength: true,
    programDataAuthorityCheckedBeforeProgramDeployment: true,
    minimumPayloadBytes: 1,
  });

  assert.equal(deploymentPlan.value.schema, "ameba-spread-devnet-reviewed-bridge-deployment-plan-v1");
  assert.equal(deploymentPlan.value.mainnetAllowed, false);
  assert.equal(deploymentPlan.value.identities?.targetProgram, EXPECTED_TARGET);
  assert.equal(deploymentPlan.value.identities?.targetProgramdata, EXPECTED_TARGET_PROGRAMDATA);
  assert.equal(deploymentPlan.value.identities?.loader, BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58());
  assert.equal(deploymentPlan.value.identities?.legacyUpgradeAuthority, EXPECTED_LEGACY_AUTHORITY);
  assert.equal(deploymentPlan.value.identities?.canonicalSpill, EXPECTED_TREASURY);
  assert.equal(deploymentPlan.value.identities?.formerAuthorityProofBuffer, proofBuffer.toBase58());
  assert.equal(deploymentPlan.value.identities?.controllerProgram, EXPECTED_CONTROLLER);
  assert.equal(minimal.value.sourceDeploymentPlanSha256, deploymentPlan.sha256);

  assert.equal(deploymentReceipt.value.schema, "ameba-spread-reviewed-governance-bridge-upgrade-receipt-v1");
  assert.equal(deploymentReceipt.value.targetProgram, EXPECTED_TARGET);
  assert.equal(deploymentReceipt.value.targetProgramdata, EXPECTED_TARGET_PROGRAMDATA);
  assert.equal(deploymentReceipt.value.loader, BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58());
  assert.equal(deploymentReceipt.value.planSha256, deploymentPlan.sha256);
  assert.equal(deploymentReceipt.value.artifactBytes, artifact.length);
  assert.equal(deploymentReceipt.value.artifactSha256, artifactSha256);
  assert.equal(deploymentReceipt.value.deployedArtifactSha256, artifactSha256);
  assert.equal(deploymentReceipt.value.postUpgradeAuthority, EXPECTED_LEGACY_AUTHORITY);
  assert.equal(deploymentReceipt.value.formerAuthorityProofBuffer, proofBuffer.toBase58());
  assert.equal(deploymentReceipt.value.formerAuthorityProofBufferPreserved, true);
  assert.equal(deploymentReceipt.value.formerAuthorityProofBufferRawSha256, proofRawSha256);
  assert.equal(minimal.value.sourceDeploymentReceiptSha256, deploymentReceipt.sha256);

  return {
    baseDescriptorSha256: base.sha256,
    descriptor: descriptor.value,
    descriptorSha256: descriptor.sha256,
    ids,
    spreadRunDir,
    runDir,
    artifact,
    artifactFile,
    artifactSha256,
    minimal,
    deploymentPlan,
    deploymentReceipt,
    handoffFinal,
    proofBuffer,
    proofRaw,
    proofRawSha256,
  };
}

function finalized(minContextSlot = 0) {
  return { commitment: "finalized", ...(minContextSlot > 0 ? { minContextSlot } : {}) };
}

function assertAccount(account, owner, length, label, executable = false) {
  assert(account, `${label} is absent`);
  assert(account.owner.equals(owner), `${label} owner changed`);
  assert.equal(account.executable, executable, `${label} executable flag changed`);
  assert.equal(account.data.length, length, `${label} length changed`);
  return account;
}

function loaderProgram(account, programdata, label) {
  const value = assertAccount(account, BPF_LOADER_UPGRADEABLE_PROGRAM_ID, PROGRAM_HEADER_LEN, label, true);
  assert.equal(value.data.readUInt32LE(0), 2, `${label} Loader variant changed`);
  assert(new PublicKey(value.data.subarray(4)).equals(programdata), `${label} ProgramData link changed`);
}

function loaderProgramdata(account, label) {
  assert(account && account.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), `${label} owner changed`);
  assert.equal(account.executable, false, `${label} became executable`);
  assert(account.data.length >= PROGRAMDATA_HEADER_LEN, `${label} is truncated`);
  assert.equal(account.data.readUInt32LE(0), 3, `${label} Loader variant changed`);
  assert.equal(account.data[12], 1, `${label} authority is absent`);
  return {
    raw: Buffer.from(account.data),
    deployedSlot: account.data.readBigUInt64LE(4),
    authority: new PublicKey(account.data.subarray(13, 45)),
    payload: Buffer.from(account.data.subarray(PROGRAMDATA_HEADER_LEN)),
    header: Buffer.from(account.data.subarray(0, PROGRAMDATA_HEADER_LEN)),
  };
}

async function rpcContext(bundle, journal, scope) {
  const rpc = await loadDevnetRpcConfiguration();
  const connection = guardRpcConnection(new Connection(rpc.stateRpcUrl, {
    commitment: "finalized",
    confirmTransactionInitialTimeout: 120_000,
  }), journal, scope);
  assert.equal(await connection.getGenesisHash(), EXPECTED_GENESIS, "RPC is not Solana Devnet");
  const slot = await connection.getSlot("finalized");
  assert(Number.isSafeInteger(slot) && slot > 0, "finalized slot is invalid");
  return { connection, slot, rpcSelection: rpc.rpcSelection };
}

function parseProofBuffer(account, bundle) {
  const value = assertAccount(account, BPF_LOADER_UPGRADEABLE_PROGRAM_ID, bundle.proofRaw.length, "minimal proof buffer");
  assert(value.data.equals(bundle.proofRaw), "minimal proof-buffer bytes changed");
  assert.equal(sha256Hex(value.data), bundle.proofRawSha256, "minimal proof-buffer raw hash changed");
  return value;
}

function boundarySummary(state) {
  return {
    targetProgram: accountFull(state.accounts.targetProgram),
    targetProgramdata: {
      ...accountFull(state.accounts.targetProgramdata),
      deployedSlot: state.targetProgramdata.deployedSlot.toString(),
      authority: state.targetProgramdata.authority.toBase58(),
    },
    controllerConfig: accountFull(state.accounts.config),
    targetNonce: state.config.targetNonce.toString(),
    protocolGate: accountFull(state.accounts.gate),
    gateStatus: state.gate.status,
    gateEpoch: state.gate.epoch.toString(),
    lifecycleRegistry: accountFull(state.accounts.registry),
    nextProposalId: state.registry.nextProposalId.toString(),
    handoffReceipt: accountFull(state.accounts.handoffReceipt),
    handoffReceiptDigest: state.handoffReceipt.receiptDigest.toString("hex"),
    handoffProposal: accountFull(state.accounts.handoffProposal),
    handoffProposalDigest: state.handoffProposal.proposalDigest.toString("hex"),
    activationProposal: null,
    activationReceipt: null,
    currentDeployment: null,
  };
}

function stateSummary(state) {
  return {
    observedSlot: state.slot,
    boundary: boundarySummary(state),
    proofBuffer: state.accounts.proofBuffer === null ? null : accountFull(state.accounts.proofBuffer),
    treasury: accountFull(state.accounts.treasury),
  };
}

async function readBoundaryState(connection, bundle, minContextSlot = 0, { bufferRequired = true } = {}) {
  const { ids } = bundle;
  const nextActivationProposal = deriveGovernanceActionProposalPdaV2(
    ids.controller,
    ids.target,
    GovernanceActionKindV2.BootstrapActivation,
    ids.proposalId + 1n,
  )[0];
  const addresses = [
    ids.target,
    ids.targetProgramdata,
    ids.config,
    ids.gate,
    ids.registry,
    ids.handoffReceipt,
    ids.handoffProposal,
    nextActivationProposal,
    ids.activationReceipt,
    ids.currentDeployment,
    bundle.proofBuffer,
    ids.treasury,
  ];
  const response = await connection.getMultipleAccountsInfoAndContext(addresses, finalized(minContextSlot));
  assert(response.context.slot >= minContextSlot, "boundary read predates minimum context");
  assert.equal(response.value.length, addresses.length, "boundary account result length changed");
  const [
    targetProgramAccount,
    targetProgramdataAccount,
    configAccount,
    gateAccount,
    registryAccount,
    handoffReceiptAccount,
    handoffProposalAccount,
    activationProposalAccount,
    activationReceiptAccount,
    currentDeploymentAccount,
    proofBufferAccount,
    treasuryAccount,
  ] = response.value;

  loaderProgram(targetProgramAccount, ids.targetProgramdata, "Spread Program");
  const targetProgramdata = loaderProgramdata(targetProgramdataAccount, "Spread ProgramData");
  assert(targetProgramdata.authority.equals(ids.authority), "Spread authority is not the controller PDA after handoff");
  assert(targetProgramdata.payload.length >= bundle.artifact.length, "Spread ProgramData capacity is below the bridge artifact");
  assert(targetProgramdata.payload.subarray(0, bundle.artifact.length).equals(bundle.artifact), "Spread payload changed after handoff");
  assert(targetProgramdata.payload.subarray(bundle.artifact.length).every((value) => value === 0), "Spread zero tail changed after handoff");

  const config = deserializeControllerConfigV1(assertAccount(configAccount, ids.controller, CONTROLLER_CONFIG_LEN, "controller config").data);
  assert(config.targetProgram.equals(ids.target), "config target changed");
  assert(config.targetProgramdata.equals(ids.targetProgramdata), "config ProgramData changed");
  assert(config.authorityPda.equals(ids.authority), "config authority changed");
  assert(config.gatePda.equals(ids.gate), "config gate changed");
  const gate = deserializeProtocolGateV1(assertAccount(gateAccount, ids.controller, PROTOCOL_GATE_LEN, "protocol gate").data);
  assert.equal(gate.status, GateStatusV1.EmergencyFrozen, "activation boundary is no longer frozen");
  assert(gate.activeProposal.equals(PublicKey.default), "activation boundary acquired an active proposal");
  assert(gate.epoch > 0n && gate.freezeSlot > 0n && gate.freezeReasonCode > 0, "frozen gate fields are malformed");
  const registry = deserializeGovernanceLifecycleRegistryV2(assertAccount(registryAccount, ids.controller, GOVERNANCE_LIFECYCLE_REGISTRY_V2_LEN, "lifecycle registry").data);
  assert(registry.controllerProgram.equals(ids.controller), "registry controller changed");
  assert(registry.controllerConfig.equals(ids.config), "registry config changed");
  assert(registry.targetProgram.equals(ids.target), "registry target changed");
  assert.equal(registry.nextProposalId, ids.proposalId + 1n, "a post-handoff governance proposal already crossed the activation boundary");

  const handoffReceipt = deserializeTargetAuthorityHandoffReceiptV1(assertAccount(handoffReceiptAccount, ids.controller, TARGET_AUTHORITY_HANDOFF_RECEIPT_V1_LEN, "handoff receipt").data);
  validateTargetAuthorityHandoffReceiptDigestV1(handoffReceipt);
  assert(handoffReceipt.finalized, "handoff receipt is not finalized");
  assert(handoffReceipt.proposal.equals(ids.handoffProposal), "handoff receipt proposal changed");
  assert(handoffReceipt.controllerProgram.equals(ids.controller), "handoff receipt controller changed");
  assert(handoffReceipt.controllerConfig.equals(ids.config), "handoff receipt config changed");
  assert(handoffReceipt.controllerAuthority.equals(ids.authority), "handoff receipt authority changed");
  assert(handoffReceipt.targetProgram.equals(ids.target), "handoff receipt target changed");
  assert(handoffReceipt.targetProgramdata.equals(ids.targetProgramdata), "handoff receipt ProgramData changed");
  assert.equal(handoffReceipt.preUpgradeAuthority.present, true, "handoff pre-authority is absent");
  assert(handoffReceipt.preUpgradeAuthority.value.equals(ids.legacyAuthority), "handoff pre-authority changed");
  assert.equal(handoffReceipt.postUpgradeAuthority.present, true, "handoff post-authority is absent");
  assert(handoffReceipt.postUpgradeAuthority.value.equals(ids.authority), "handoff post-authority changed");
  assert(handoffReceipt.postProgramdataHeaderSnapshot.equals(targetProgramdata.header), "handoff ProgramData header changed");
  assert.equal(handoffReceipt.deployedSlot, targetProgramdata.deployedSlot, "handoff deployed slot changed");
  assert.equal(handoffReceipt.rawProgramdataLength, BigInt(targetProgramdata.raw.length), "handoff raw ProgramData length changed");
  assert.equal(handoffReceipt.programdataCapacity, BigInt(targetProgramdata.payload.length), "handoff capacity changed");
  assert.equal(handoffReceipt.artifactLength, BigInt(bundle.artifact.length), "handoff artifact length changed");
  assert.equal(handoffReceipt.artifactSha256.toString("hex"), bundle.artifactSha256, "handoff artifact hash changed");
  assert.equal(handoffReceipt.bootstrapGateEpoch, gate.epoch, "handoff gate epoch changed");
  assert.equal(handoffReceipt.targetNonce, config.targetNonce, "handoff target nonce changed");
  assert.equal(sha256Hex(handoffReceiptAccount.data), bundle.handoffFinal.value.handoffReceiptSha256, "handoff final receipt no longer matches its on-chain account");

  const handoffProposal = deserializeTargetAuthorityHandoffProposalV2(assertAccount(handoffProposalAccount, ids.controller, TARGET_AUTHORITY_HANDOFF_PROPOSAL_V2_LEN, "handoff proposal").data);
  assert.equal(handoffProposal.state, GovernanceLifecycleStateV2.Completed, "handoff proposal is not completed");
  assert.equal(handoffProposal.proposalId, ids.proposalId, "handoff proposal ID changed");
  assert.equal(handoffProposal.proposalDigest.toString("hex"), bundle.handoffFinal.value.proposal.digest, "handoff proposal digest changed");
  assert(handoffReceipt.proposalDigest.equals(handoffProposal.proposalDigest), "handoff receipt proposal digest changed");
  assert.equal(activationProposalAccount, null, "activation proposal exists before former-authority proof closure");
  assert.equal(activationReceiptAccount, null, "activation receipt exists before former-authority proof closure");
  assert.equal(currentDeploymentAccount, null, "current deployment exists before former-authority proof closure");
  assert(treasuryAccount, "canonical treasury is absent");
  assert(treasuryAccount.owner.equals(SystemProgram.programId), "canonical treasury owner changed");
  assert.equal(treasuryAccount.executable, false, "canonical treasury became executable");
  assert.equal(treasuryAccount.data.length, 0, "canonical treasury acquired data");
  if (bufferRequired) parseProofBuffer(proofBufferAccount, bundle);
  else assert.equal(proofBufferAccount, null, "proof buffer remains live after close");

  return {
    slot: response.context.slot,
    targetProgramdata,
    config,
    gate,
    registry,
    handoffReceipt,
    handoffProposal,
    accounts: {
      targetProgram: targetProgramAccount,
      targetProgramdata: targetProgramdataAccount,
      config: configAccount,
      gate: gateAccount,
      registry: registryAccount,
      handoffReceipt: handoffReceiptAccount,
      handoffProposal: handoffProposalAccount,
      activationProposal: null,
      activationReceipt: null,
      currentDeployment: null,
      proofBuffer: proofBufferAccount,
      treasury: treasuryAccount,
    },
  };
}

function upgradeInstruction(bundle) {
  const { ids } = bundle;
  return new TransactionInstruction({
    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    keys: [
      { pubkey: ids.targetProgramdata, isSigner: false, isWritable: true },
      { pubkey: ids.target, isSigner: false, isWritable: true },
      { pubkey: bundle.proofBuffer, isSigner: false, isWritable: true },
      { pubkey: ids.treasury, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: ids.legacyAuthority, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(LOADER_UPGRADE_DATA),
  });
}

function closeInstruction(bundle) {
  const { ids } = bundle;
  return new TransactionInstruction({
    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    keys: [
      { pubkey: bundle.proofBuffer, isSigner: false, isWritable: true },
      { pubkey: ids.treasury, isSigner: false, isWritable: true },
      { pubkey: ids.legacyAuthority, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(LOADER_CLOSE_DATA),
  });
}

function compileAction(action, blockhash) {
  assert.equal(action.instructions.length, 1, "former-authority boundary permits exactly one instruction");
  assert(action.instructions[0].programId.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), "former-authority boundary permits only Loader-v3");
  const message = new TransactionMessage({
    payerKey: action.signers[0],
    recentBlockhash: blockhash,
    instructions: action.instructions,
  }).compileToV0Message();
  assert.deepEqual(
    message.staticAccountKeys.slice(0, message.header.numRequiredSignatures).map((entry) => entry.toBase58()),
    action.signers.map((entry) => entry.toBase58()),
    "former-authority boundary signer order changed",
  );
  const transaction = new VersionedTransaction(message);
  const packetBytes = transaction.serialize().length;
  assert(packetBytes <= MAX_PACKET_BYTES, `former-authority boundary packet is ${packetBytes} bytes`);
  return { transaction, packetBytes, messageSha256: sha256Hex(Buffer.from(message.serialize())) };
}

function assertIncorrectAuthority(error, logs, label) {
  assert(error && typeof error === "object", `${label} unexpectedly succeeded`);
  assert(Array.isArray(error.InstructionError) && error.InstructionError.length === 2, `${label} is not an InstructionError`);
  assert.equal(error.InstructionError[0], 0, `${label} failed in the wrong instruction`);
  assert.equal(error.InstructionError[1], "IncorrectAuthority", `${label} did not fail with IncorrectAuthority`);
  assert(Array.isArray(logs) && logs.some((entry) => entry.includes("Incorrect authority provided")), `${label} logs do not prove IncorrectAuthority`);
}

async function readOptionalReceipt(bundle, name, schema) {
  const file = path.join(bundle.runDir, name);
  try {
    const value = await secureJsonFile(file, schema);
    assert.equal(value.value.schema, schema, `${schema} receipt schema changed`);
    assert.equal(value.value.descriptorSha256, bundle.descriptorSha256);
    assert.equal(value.value.baseDescriptorSha256, bundle.baseDescriptorSha256);
    assert.equal(value.value.genesisHash, EXPECTED_GENESIS);
    assert.equal(value.value.controllerProgram, EXPECTED_CONTROLLER);
    assert.equal(value.value.controllerAuthority, bundle.ids.authority.toBase58());
    assert.equal(value.value.targetProgram, EXPECTED_TARGET);
    assert.equal(value.value.targetProgramdata, EXPECTED_TARGET_PROGRAMDATA);
    assert.equal(value.value.proofBuffer, bundle.proofBuffer.toBase58());
    assert.equal(value.value.minimalProofBufferReceiptSha256, bundle.minimal.sha256);
    const expectedDomain = schema === NEGATIVE_RECEIPT_SCHEMA
      ? "AMOEBA_GOVERNANCE_V2_FORMER_AUTHORITY_NEGATIVE_PROOF_V1"
      : "AMOEBA_GOVERNANCE_V2_FORMER_AUTHORITY_PROOF_BUFFER_CLOSE_V1";
    assert.equal(value.value.receiptSha256, semanticReceiptHash(expectedDomain, value.value), `${schema} semantic receipt hash changed`);
    return value;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function stageFor(bundle) {
  const negative = await readOptionalReceipt(bundle, NEGATIVE_RECEIPT_FILE, NEGATIVE_RECEIPT_SCHEMA);
  const close = await readOptionalReceipt(bundle, CLOSE_RECEIPT_FILE, CLOSE_RECEIPT_SCHEMA);
  if (close) {
    assert(negative, "close receipt exists without a negative proof receipt");
    assert.equal(close.value.negativeProofReceiptSha256, negative.sha256, "close receipt negative-proof hash changed");
    return { kind: "complete", stage: "complete", negative, close };
  }
  if (negative) return { kind: "mutation", stage: CLOSE_STAGE, negative, close: null };
  return { kind: "mutation", stage: NEGATIVE_STAGE, negative: null, close: null };
}

function actionFor(bundle, stage) {
  const instruction = stage === NEGATIVE_STAGE ? upgradeInstruction(bundle) : closeInstruction(bundle);
  return {
    stage,
    signers: [bundle.ids.payer, bundle.ids.legacyAuthority],
    instructions: [instruction],
  };
}

function publicAction(action, state) {
  return {
    stage: action.stage,
    expectedFailure: action.stage === NEGATIVE_STAGE ? "IncorrectAuthority" : null,
    signers: action.signers.map((entry) => entry.toBase58()),
    instructions: action.instructions.map(instructionManifest),
    observedState: stateSummary(state),
  };
}

function assertPlanState(plan, action, state, bundle) {
  assert.equal(plan.stage, action.stage, "planned stage changed");
  assert.deepEqual(plan.signers, action.signers.map((entry) => entry.toBase58()), "planned signer set changed");
  assert.deepEqual(plan.instructions, action.instructions.map(instructionManifest), "planned instruction changed");
  const current = stateSummary(state);
  assert(current.observedSlot >= plan.stateBefore.observedSlot, "activation-boundary observation slot regressed");
  assert.deepEqual(
    { ...current, observedSlot: plan.stateBefore.observedSlot },
    plan.stateBefore,
    "activation boundary changed after planning",
  );
  assert.equal(plan.minimalProofBufferReceiptSha256, bundle.minimal.sha256);
  assert.equal(plan.handoffFinalReceiptSha256, bundle.handoffFinal.sha256);
}

async function writePlan(bundle, stage, state, negative) {
  const action = actionFor(bundle, stage);
  const compiled = compileAction(action, PublicKey.default.toBase58());
  const material = {
    schema: PLAN_SCHEMA,
    command: "execute-next",
    stage,
    mainnetAllowed: false,
    genesisHash: EXPECTED_GENESIS,
    descriptorSha256: bundle.descriptorSha256,
    baseDescriptorSha256: bundle.baseDescriptorSha256,
    observedSlot: state.slot,
    validUntilSlot: state.slot + PLAN_VALIDITY_SLOTS,
    controllerProgram: bundle.ids.controller.toBase58(),
    controllerAuthority: bundle.ids.authority.toBase58(),
    targetProgram: bundle.ids.target.toBase58(),
    targetProgramdata: bundle.ids.targetProgramdata.toBase58(),
    formerAuthority: bundle.ids.legacyAuthority.toBase58(),
    feePayer: bundle.ids.payer.toBase58(),
    proofBuffer: bundle.proofBuffer.toBase58(),
    treasury: bundle.ids.treasury.toBase58(),
    minimalProofBufferReceiptSha256: bundle.minimal.sha256,
    deploymentPlanSha256: bundle.deploymentPlan.sha256,
    deploymentReceiptSha256: bundle.deploymentReceipt.sha256,
    handoffFinalReceiptSha256: bundle.handoffFinal.sha256,
    negativeProofReceiptSha256: negative?.sha256 ?? null,
    artifactSha256: bundle.artifactSha256,
    packetBytes: compiled.packetBytes,
    signers: action.signers.map((entry) => entry.toBase58()),
    instructions: action.instructions.map(instructionManifest),
    stateBefore: stateSummary(state),
    automaticRetryAllowed: false,
  };
  const plan = { ...material, operationId: operationId(material) };
  const file = path.join(bundle.runDir, `v2-former-authority-${stage}-plan-${plan.operationId}.json`);
  await writeExclusiveJson(file, plan);
  const raw = await readFile(file);
  const planSha256 = sha256Hex(raw);
  const arm = `execute-proof-close-next:${plan.operationId}:${planSha256}`;
  process.stdout.write(`${JSON.stringify({ planFile: file, planSha256, arm, decodedAction: publicAction(action, state) }, null, 2)}\n`);
  return { file, raw, plan, planSha256 };
}

async function loadPlan(bundle) {
  const file = await requireSecureRegularFile(env("AMEBA_GOVERNANCE_V2_PROOF_CLOSE_PLAN"), "former-authority proof/close plan");
  assert.equal(path.dirname(file), bundle.runDir, "former-authority plan escaped its run directory");
  const raw = await readFile(file);
  const plan = JSON.parse(raw.toString("utf8"));
  assert.equal(plan.schema, PLAN_SCHEMA);
  assert.equal(plan.command, "execute-next");
  assert([NEGATIVE_STAGE, CLOSE_STAGE].includes(plan.stage), "former-authority plan stage changed");
  assert.equal(plan.mainnetAllowed, false);
  assert.equal(plan.genesisHash, EXPECTED_GENESIS);
  assert.equal(plan.descriptorSha256, bundle.descriptorSha256);
  assert.equal(plan.baseDescriptorSha256, bundle.baseDescriptorSha256);
  assert.equal(plan.minimalProofBufferReceiptSha256, bundle.minimal.sha256);
  assert.equal(plan.deploymentPlanSha256, bundle.deploymentPlan.sha256);
  assert.equal(plan.deploymentReceiptSha256, bundle.deploymentReceipt.sha256);
  assert.equal(plan.handoffFinalReceiptSha256, bundle.handoffFinal.sha256);
  assert.equal(plan.artifactSha256, bundle.artifactSha256);
  assert.equal(plan.controllerProgram, bundle.ids.controller.toBase58());
  assert.equal(plan.controllerAuthority, bundle.ids.authority.toBase58());
  assert.equal(plan.targetProgram, bundle.ids.target.toBase58());
  assert.equal(plan.targetProgramdata, bundle.ids.targetProgramdata.toBase58());
  assert.equal(plan.formerAuthority, bundle.ids.legacyAuthority.toBase58());
  assert.equal(plan.feePayer, bundle.ids.payer.toBase58());
  assert.equal(plan.proofBuffer, bundle.proofBuffer.toBase58());
  assert.equal(plan.treasury, bundle.ids.treasury.toBase58());
  assert(Number.isSafeInteger(plan.observedSlot) && plan.observedSlot > 0, "former-authority plan observation slot is invalid");
  assert.equal(plan.validUntilSlot, plan.observedSlot + PLAN_VALIDITY_SLOTS, "former-authority plan validity changed");
  assert(Number.isSafeInteger(plan.packetBytes) && plan.packetBytes > 0 && plan.packetBytes <= MAX_PACKET_BYTES, "former-authority plan packet size is invalid");
  assert.equal(plan.automaticRetryAllowed, false);
  const { operationId: recorded, ...material } = plan;
  assert.equal(recorded, operationId(material), "former-authority plan operation ID changed");
  const planSha256 = sha256Hex(raw);
  assert.equal(
    env("AMEBA_GOVERNANCE_V2_PROOF_CLOSE_ARM"),
    `execute-proof-close-next:${recorded}:${planSha256}`,
    "former-authority execution is not armed for this exact plan",
  );
  return { file, raw, plan, planSha256 };
}

async function assertNoOtherNegativeAttempt(bundle, operationIdValue) {
  for (const name of (await readdir(bundle.runDir)).filter((entry) => entry.endsWith(".jsonl")).sort()) {
    const file = await requireSecureRegularFile(path.join(bundle.runDir, name), `ceremony journal ${name}`);
    const text = await readFile(file, "utf8");
    assert(text.length === 0 || text.endsWith("\n"), `ceremony journal ${name} has a partial tail`);
    for (const line of text.split("\n")) {
      if (line.length === 0) continue;
      const entry = JSON.parse(line);
      if (entry.event !== "negative-prepared") continue;
      assert.equal(entry.operationId, operationIdValue, "a different former-authority Loader Upgrade attempt was already prepared");
    }
  }
}

function findNegativePrepared(journal) {
  const attempts = journal.entries.filter((entry) => entry.event === "negative-prepared");
  assert(attempts.length <= 1, "more than one former-authority Loader Upgrade attempt was prepared");
  return attempts[0] ?? null;
}

function validateNegativePrepared(prepared, plan, bundle) {
  assert.equal(prepared.stage, NEGATIVE_STAGE);
  assert.equal(prepared.planSha256, plan.planSha256);
  assert.equal(prepared.minContextSlot >= plan.plan.observedSlot, true, "negative prepared context predates plan");
  assert.deepEqual(prepared.expectedSigners, [EXPECTED_PAYER, EXPECTED_LEGACY_AUTHORITY]);
  const wire = Buffer.from(prepared.wireBase64, "base64");
  assert.equal(wire.toString("base64"), prepared.wireBase64, "negative prepared wire is noncanonical base64");
  assert.equal(sha256Hex(wire), prepared.wireSha256, "negative prepared wire hash changed");
  assert.equal(wire.length, prepared.wireBytes, "negative prepared wire length changed");
  const transaction = VersionedTransaction.deserialize(wire);
  assert.equal(bs58.encode(transaction.signatures[0]), prepared.signature, "negative prepared signature changed");
  assert.equal(sha256Hex(Buffer.from(transaction.message.serialize())), prepared.messageSha256, "negative prepared message changed");
  const decompiled = TransactionMessage.decompile(transaction.message);
  assert.equal(decompiled.instructions.length, 1, "negative prepared transaction acquired a sibling instruction");
  assert.deepEqual(instructionManifest(decompiled.instructions[0]), instructionManifest(upgradeInstruction(bundle)), "negative prepared Loader instruction changed");
  assert.equal(transaction.serialize().length, plan.plan.packetBytes, "negative prepared packet length changed");
  assertIncorrectAuthority(prepared.simulationError, prepared.simulationLogs, "negative prepared simulation");
  return { transaction, wire };
}

async function finalizedNegative(connection, prepared) {
  const landed = await connection.getTransaction(prepared.signature, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  if (landed === null) return null;
  assert(landed.meta, "negative finalized transaction metadata is absent");
  assert.equal(landed.transaction.signatures[0], prepared.signature, "negative finalized signature changed");
  assert.equal(sha256Hex(Buffer.from(landed.transaction.message.serialize())), prepared.messageSha256, "negative finalized message changed");
  assertIncorrectAuthority(landed.meta.err, landed.meta.logMessages, "negative finalized transaction");
  return landed;
}

async function waitNegativeFinalized(connection, journal, prepared) {
  for (;;) {
    const landed = await finalizedNegative(connection, prepared);
    if (landed) return landed;
    const statuses = await connection.getSignatureStatuses([prepared.signature], { searchTransactionHistory: true });
    assert.equal(statuses.value.length, 1, "negative status response length changed");
    const status = statuses.value[0];
    if (status?.confirmationStatus === "finalized") {
      const exact = await finalizedNegative(connection, prepared);
      assert(exact, "negative signature is finalized without transaction history");
      return exact;
    }
    const blockHeight = await connection.getBlockHeight("finalized");
    if (status === null && blockHeight > prepared.lastValidBlockHeight) {
      const slot = await connection.getSlot("finalized");
      await journal.append("negative-expired-not-landed", {
        stage: NEGATIVE_STAGE,
        signature: prepared.signature,
        finalizedSlot: slot,
        observedBlockHeight: blockHeight,
        automaticRetry: false,
      });
      throw new Error("the one authorized former-authority Loader Upgrade attempt expired without landing; do not submit another attempt");
    }
    await new Promise((resolve) => setTimeout(resolve, FINALIZED_TRANSACTION_POLL_INTERVAL_MS));
  }
}

async function writeReceiptOnce(file, receipt) {
  try {
    await writeExclusiveJson(file, receipt);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), receipt, "existing deterministic receipt changed");
  }
  return secureJsonFile(file, "former-authority boundary receipt");
}

async function executeNegative(bundle, selected, connection, journal) {
  await assertNoOtherNegativeAttempt(bundle, selected.plan.operationId);
  let prepared = findNegativePrepared(journal);
  if (prepared) {
    validateNegativePrepared(prepared, selected, bundle);
    const landed = await waitNegativeFinalized(connection, journal, prepared);
    const current = await readBoundaryState(connection, bundle, landed.slot, { bufferRequired: true });
    return writeNegativeReceipt(bundle, selected, prepared, landed, prepared.stateBefore, current);
  }

  let before = await readBoundaryState(connection, bundle, selected.plan.observedSlot, { bufferRequired: true });
  const action = actionFor(bundle, NEGATIVE_STAGE);
  assertPlanState(selected.plan, action, before, bundle);
  assert(before.slot <= selected.plan.validUntilSlot, "former-authority negative plan expired");
  const latest = await connection.getLatestBlockhashAndContext({ commitment: "finalized", minContextSlot: before.slot });
  assert(latest.context.slot >= before.slot, "negative blockhash predates the plan state");
  before = await readBoundaryState(connection, bundle, latest.context.slot, { bufferRequired: true });
  assertPlanState(selected.plan, action, before, bundle);
  const compiled = compileAction(action, latest.value.blockhash);
  assert.equal(compiled.packetBytes, selected.plan.packetBytes, "negative packet size changed");
  process.stdout.write(`${JSON.stringify({ decodedAction: publicAction(action, before), operationId: selected.plan.operationId, planSha256: selected.planSha256 }, null, 2)}\n`);
  await journal.append("decoded-action", { stage: NEGATIVE_STAGE, planSha256: selected.planSha256, decodedAction: publicAction(action, before) });
  const provider = await loadInjectedSignerProvider(bundle.runDir, "AMEBA_GOVERNANCE_V2_SIGNER_PROVIDER");
  const signed = await signTransactionWithProvider({
    providerValue: provider,
    transaction: compiled.transaction,
    expectedSigners: action.signers,
    operationId: selected.plan.operationId,
    stage: NEGATIVE_STAGE,
  });
  const simulation = await connection.simulateTransaction(signed.transaction, {
    commitment: "processed",
    sigVerify: true,
    replaceRecentBlockhash: false,
    minContextSlot: before.slot,
  });
  assertIncorrectAuthority(simulation.value.err, simulation.value.logs, "former-authority simulation");
  const exactBefore = await readBoundaryState(connection, bundle, before.slot, { bufferRequired: true });
  assertPlanState(selected.plan, action, exactBefore, bundle);
  const validity = await connection.isBlockhashValid(latest.value.blockhash, finalized(exactBefore.slot));
  assert(validity.context.slot >= exactBefore.slot && validity.value === true, "negative blockhash expired before the one authorized submission");
  const wire = Buffer.from(signed.transaction.serialize());
  const signature = bs58.encode(signed.transaction.signatures[0]);
  prepared = await journal.append("negative-prepared", {
    stage: NEGATIVE_STAGE,
    planSha256: selected.planSha256,
    signature,
    blockhash: latest.value.blockhash,
    lastValidBlockHeight: latest.value.lastValidBlockHeight,
    minContextSlot: exactBefore.slot,
    expectedSigners: action.signers.map((entry) => entry.toBase58()),
    messageSha256: sha256Hex(Buffer.from(signed.transaction.message.serialize())),
    wireSha256: sha256Hex(wire),
    wireBytes: wire.length,
    wireBase64: wire.toString("base64"),
    signerProvider: signed.providerEvidence,
    simulationError: simulation.value.err,
    simulationLogs: simulation.value.logs ?? [],
    stateBefore: stateSummary(exactBefore),
  });
  let returned;
  try {
    returned = await connection.sendRawTransaction(wire, {
      skipPreflight: true,
      maxRetries: 0,
      minContextSlot: exactBefore.slot,
    });
  } catch (error) {
    if (error instanceof RpcBackoffExit) throw error;
    await journal.append("negative-submission-unknown", {
      stage: NEGATIVE_STAGE,
      signature,
      errorSha256: sha256Hex(Buffer.from(String(error?.message ?? error), "utf8")),
      automaticRetry: false,
    });
    throw new Error(`former-authority negative submission outcome is unknown; reconcile ${signature} without resubmission`);
  }
  assert.equal(returned, signature, "negative RPC returned a different signature");
  await journal.append("negative-submitted", { stage: NEGATIVE_STAGE, signature, automaticRetry: false });
  const landed = await waitNegativeFinalized(connection, journal, prepared);
  await journal.append("negative-finalized", {
    stage: NEGATIVE_STAGE,
    signature,
    slot: landed.slot,
    errorSha256: sha256Hex(Buffer.from(JSON.stringify(landed.meta.err), "utf8")),
    logsSha256: sha256Hex(Buffer.from(JSON.stringify(landed.meta.logMessages ?? []), "utf8")),
  });
  const after = await readBoundaryState(connection, bundle, landed.slot, { bufferRequired: true });
  return writeNegativeReceipt(bundle, selected, prepared, landed, stateSummary(exactBefore), after);
}

async function writeNegativeReceipt(bundle, selected, prepared, landed, beforeSummary, afterState) {
  const afterSummary = stateSummary(afterState);
  assert.deepEqual(afterSummary.boundary, beforeSummary.boundary, "failed old-authority upgrade changed the activation boundary");
  assert.deepEqual(afterSummary.proofBuffer, beforeSummary.proofBuffer, "failed old-authority upgrade consumed or changed the proof buffer");
  assert.deepEqual(afterSummary.treasury, beforeSummary.treasury, "failed old-authority upgrade changed the treasury");
  const material = {
    schema: NEGATIVE_RECEIPT_SCHEMA,
    mainnetAllowed: false,
    genesisHash: EXPECTED_GENESIS,
    descriptorSha256: bundle.descriptorSha256,
    baseDescriptorSha256: bundle.baseDescriptorSha256,
    operationId: selected.plan.operationId,
    planFile: path.basename(selected.file),
    planSha256: selected.planSha256,
    minimalProofBufferReceiptSha256: bundle.minimal.sha256,
    deploymentPlanSha256: bundle.deploymentPlan.sha256,
    deploymentReceiptSha256: bundle.deploymentReceipt.sha256,
    handoffFinalReceiptSha256: bundle.handoffFinal.sha256,
    stage: NEGATIVE_STAGE,
    controllerProgram: bundle.ids.controller.toBase58(),
    controllerAuthority: bundle.ids.authority.toBase58(),
    targetProgram: bundle.ids.target.toBase58(),
    targetProgramdata: bundle.ids.targetProgramdata.toBase58(),
    formerAuthority: bundle.ids.legacyAuthority.toBase58(),
    feePayer: bundle.ids.payer.toBase58(),
    proofBuffer: bundle.proofBuffer.toBase58(),
    treasury: bundle.ids.treasury.toBase58(),
    expectedInstructionError: "IncorrectAuthority",
    instruction: instructionManifest(upgradeInstruction(bundle)),
    signature: prepared.signature,
    finalizedSlot: landed.slot,
    messageSha256: prepared.messageSha256,
    wireSha256: prepared.wireSha256,
    wireBytes: prepared.wireBytes,
    signerProvider: prepared.signerProvider,
    simulationError: prepared.simulationError,
    simulationLogs: prepared.simulationLogs,
    finalizedError: landed.meta.err,
    finalizedLogs: landed.meta.logMessages ?? [],
    stateBefore: beforeSummary,
    stateAfter: afterSummary,
    targetMutationObserved: false,
    proofBufferMutationObserved: false,
    activationBoundaryMutationObserved: false,
    receiptSha256: "",
  };
  material.receiptSha256 = semanticReceiptHash("AMOEBA_GOVERNANCE_V2_FORMER_AUTHORITY_NEGATIVE_PROOF_V1", material);
  return writeReceiptOnce(path.join(bundle.runDir, NEGATIVE_RECEIPT_FILE), material);
}

function coreCloseBoundary(summary) {
  return summary.boundary;
}

async function executeClose(bundle, selected, connection, journal, negative) {
  const action = actionFor(bundle, CLOSE_STAGE);
  const dummy = compileAction(action, PublicKey.default.toBase58());
  const verifyPrestate = async (minimumSlot) => {
    const current = await readBoundaryState(connection, bundle, minimumSlot, { bufferRequired: true });
    assertPlanState(selected.plan, action, current, bundle);
    return { slot: current.slot };
  };
  const reconciled = await reconcileOneFinalized({
    connection,
    journal,
    operationId: selected.plan.operationId,
    stage: CLOSE_STAGE,
    expectedSigners: action.signers,
    expectedPacketBytes: dummy.packetBytes,
    verifyImmediatelyBeforeResubmit: verifyPrestate,
    verifyExpiredPrestate: verifyPrestate,
  });
  let landed = reconciled;
  if (!landed) {
    let before = await readBoundaryState(connection, bundle, selected.plan.observedSlot, { bufferRequired: true });
    assertPlanState(selected.plan, action, before, bundle);
    assert(before.slot <= selected.plan.validUntilSlot, "proof-buffer Close plan expired");
    const latest = await connection.getLatestBlockhashAndContext({ commitment: "finalized", minContextSlot: before.slot });
    before = await readBoundaryState(connection, bundle, latest.context.slot, { bufferRequired: true });
    assertPlanState(selected.plan, action, before, bundle);
    const compiled = compileAction(action, latest.value.blockhash);
    assert.equal(compiled.packetBytes, selected.plan.packetBytes, "proof-buffer Close packet size changed");
    process.stdout.write(`${JSON.stringify({ decodedAction: publicAction(action, before), operationId: selected.plan.operationId, planSha256: selected.planSha256 }, null, 2)}\n`);
    await journal.append("decoded-action", { stage: CLOSE_STAGE, planSha256: selected.planSha256, decodedAction: publicAction(action, before) });
    const provider = await loadInjectedSignerProvider(bundle.runDir, "AMEBA_GOVERNANCE_V2_SIGNER_PROVIDER");
    const signed = await signTransactionWithProvider({
      providerValue: provider,
      transaction: compiled.transaction,
      expectedSigners: action.signers,
      operationId: selected.plan.operationId,
      stage: CLOSE_STAGE,
    });
    const simulation = await connection.simulateTransaction(signed.transaction, {
      commitment: "processed",
      sigVerify: true,
      replaceRecentBlockhash: false,
      minContextSlot: before.slot,
    });
    assert.equal(simulation.value.err, null, "proof-buffer Close simulation failed");
    landed = await submitOneFinalized({
      connection,
      transaction: signed.transaction,
      latestBlockhash: latest.value,
      journal,
      operationId: selected.plan.operationId,
      stage: CLOSE_STAGE,
      expectedSigners: action.signers,
      expectedPacketBytes: compiled.packetBytes,
      minContextSlot: before.slot,
      preparedContext: {
        planSha256: selected.planSha256,
        signerProvider: signed.providerEvidence,
        negativeProofReceiptSha256: negative.sha256,
        stateBefore: stateSummary(before),
      },
      verifyImmediatelyBeforeSubmit: verifyPrestate,
      verifyExpiredPrestate: verifyPrestate,
    });
  }
  const after = await readBoundaryState(connection, bundle, landed.slot, { bufferRequired: false });
  const prepared = journal.entries.find((entry) => entry.event === "prepared" && entry.stage === CLOSE_STAGE && entry.signature === landed.signature);
  assert(prepared, "proof-buffer Close lacks its prepared transaction evidence");
  assert.deepEqual(landed.preparedContext, prepared.preparedContext, "proof-buffer Close prepared context changed");
  assert.equal(prepared.preparedContext?.planSha256, selected.planSha256, "proof-buffer Close plan binding changed");
  assert.equal(prepared.preparedContext?.negativeProofReceiptSha256, negative.sha256, "proof-buffer Close negative-proof binding changed");
  assert(prepared.preparedContext?.stateBefore, "proof-buffer Close prestate evidence is absent");
  return writeCloseReceipt(bundle, selected, negative, prepared, landed, prepared.preparedContext.stateBefore, after);
}

async function writeCloseReceipt(bundle, selected, negative, prepared, landed, beforeSummary, after) {
  const afterSummary = stateSummary(after);
  assert.deepEqual(afterSummary.boundary, beforeSummary.boundary, "proof-buffer Close changed the activation boundary");
  assert.equal(afterSummary.proofBuffer, null, "proof-buffer Close did not remove the exact proof buffer");
  const bufferLamports = beforeSummary.proofBuffer.lamports;
  assert.equal(afterSummary.treasury.lamports - beforeSummary.treasury.lamports, bufferLamports, "proof-buffer Close treasury delta changed");
  assert.deepEqual({ ...afterSummary.treasury, lamports: 0 }, { ...beforeSummary.treasury, lamports: 0 }, "proof-buffer Close changed treasury structure");
  const material = {
    schema: CLOSE_RECEIPT_SCHEMA,
    mainnetAllowed: false,
    genesisHash: EXPECTED_GENESIS,
    descriptorSha256: bundle.descriptorSha256,
    baseDescriptorSha256: bundle.baseDescriptorSha256,
    operationId: selected.plan.operationId,
    planFile: path.basename(selected.file),
    planSha256: selected.planSha256,
    minimalProofBufferReceiptSha256: bundle.minimal.sha256,
    negativeProofReceipt: NEGATIVE_RECEIPT_FILE,
    negativeProofReceiptSha256: negative.sha256,
    negativeFailureSignature: negative.value.signature,
    stage: CLOSE_STAGE,
    controllerProgram: bundle.ids.controller.toBase58(),
    controllerAuthority: bundle.ids.authority.toBase58(),
    targetProgram: bundle.ids.target.toBase58(),
    targetProgramdata: bundle.ids.targetProgramdata.toBase58(),
    formerAuthority: bundle.ids.legacyAuthority.toBase58(),
    feePayer: bundle.ids.payer.toBase58(),
    proofBuffer: bundle.proofBuffer.toBase58(),
    treasury: bundle.ids.treasury.toBase58(),
    instruction: instructionManifest(closeInstruction(bundle)),
    signature: landed.signature,
    finalizedSlot: landed.slot,
    messageSha256: landed.messageSha256,
    wireSha256: prepared.wireSha256,
    wireBytes: landed.wireBytes,
    signerProvider: landed.preparedContext?.signerProvider ?? null,
    proofBufferLamports: bufferLamports,
    treasuryLamportsBefore: beforeSummary.treasury.lamports,
    treasuryLamportsAfter: afterSummary.treasury.lamports,
    treasuryLamportDelta: bufferLamports,
    stateBefore: beforeSummary,
    stateAfter: afterSummary,
    targetMutationObserved: false,
    activationBoundaryMutationObserved: false,
    bufferClosed: true,
    receiptSha256: "",
  };
  material.receiptSha256 = semanticReceiptHash("AMOEBA_GOVERNANCE_V2_FORMER_AUTHORITY_PROOF_BUFFER_CLOSE_V1", material);
  return writeReceiptOnce(path.join(bundle.runDir, CLOSE_RECEIPT_FILE), material);
}

async function status() {
  const bundle = await loadBundle();
  const statusId = operationId({ schema: "ameba-governance-v2-former-authority-boundary-status-v1", descriptor: bundle.descriptorSha256, timestampBucket: Math.floor(Date.now() / 1_000) });
  return withCeremonyRpcOwnerLock(bundle.runDir, statusId, async () => {
    const journal = await openJournal(bundle.runDir, `v2-former-authority-status-${statusId.slice(0, 12)}`, statusId);
    try {
      const { connection, slot } = await rpcContext(bundle, journal, "v2-former-authority-status");
      const stage = await stageFor(bundle);
      const state = await readBoundaryState(connection, bundle, slot, { bufferRequired: stage.kind !== "complete" });
      const result = { status: stage.kind, stage: stage.stage, state: stateSummary(state), negativeReceiptSha256: stage.negative?.sha256 ?? null, closeReceiptSha256: stage.close?.sha256 ?? null };
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return result;
    } finally {
      await journal.close();
    }
  });
}

async function planNext() {
  const bundle = await loadBundle();
  const planningId = operationId({ schema: "ameba-governance-v2-former-authority-boundary-planning-v1", descriptor: bundle.descriptorSha256, timestampBucket: Math.floor(Date.now() / 1_000) });
  return withCeremonyRpcOwnerLock(bundle.runDir, planningId, async () => {
    const journal = await openJournal(bundle.runDir, `v2-former-authority-planning-${planningId.slice(0, 12)}`, planningId);
    try {
      const { connection, slot } = await rpcContext(bundle, journal, "v2-former-authority-plan");
      const stage = await stageFor(bundle);
      const state = await readBoundaryState(connection, bundle, slot, { bufferRequired: stage.kind !== "complete" });
      if (stage.kind === "complete") {
        const result = { status: "complete", negativeReceiptSha256: stage.negative.sha256, closeReceiptSha256: stage.close.sha256, state: stateSummary(state) };
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return result;
      }
      return writePlan(bundle, stage.stage, state, stage.negative);
    } finally {
      await journal.close();
    }
  });
}

async function executeNext() {
  const bundle = await loadBundle();
  const selected = await loadPlan(bundle);
  return withExecutionLock(bundle.runDir, `v2-former-authority-${selected.plan.operationId.slice(0, 12)}`, selected.plan.operationId, async () => (
    withCeremonyRpcOwnerLock(bundle.runDir, selected.plan.operationId, async () => {
      const journal = await openJournal(bundle.runDir, `v2-former-authority-${selected.plan.stage}-${selected.plan.operationId.slice(0, 12)}`, selected.plan.operationId);
      try {
        const { connection } = await rpcContext(bundle, journal, `v2-former-authority-${selected.plan.stage}`);
        const currentStage = await stageFor(bundle);
        assert.equal(
          selected.plan.negativeProofReceiptSha256,
          currentStage.negative?.sha256 ?? null,
          "former-authority plan negative-proof binding is no longer current",
        );
        if (selected.plan.stage === NEGATIVE_STAGE) {
          assert(currentStage.stage === NEGATIVE_STAGE || findNegativePrepared(journal), "negative-proof stage is no longer current");
          return await executeNegative(bundle, selected, connection, journal);
        }
        assert.equal(currentStage.stage, CLOSE_STAGE, "proof-buffer Close stage is no longer current");
        return await executeClose(bundle, selected, connection, journal, currentStage.negative);
      } finally {
        await journal.close();
      }
    })
  ));
}

async function verifyEvidenceOffline() {
  const bundle = await loadBundle();
  const result = {
    schema: "ameba-governance-devnet-v2-former-authority-boundary-evidence-v1",
    genesisHash: EXPECTED_GENESIS,
    descriptorSha256: bundle.descriptorSha256,
    controllerProgram: bundle.ids.controller.toBase58(),
    controllerAuthority: bundle.ids.authority.toBase58(),
    targetProgram: bundle.ids.target.toBase58(),
    targetProgramdata: bundle.ids.targetProgramdata.toBase58(),
    formerAuthority: bundle.ids.legacyAuthority.toBase58(),
    proofBuffer: bundle.proofBuffer.toBase58(),
    treasury: bundle.ids.treasury.toBase58(),
    artifact: { bytes: bundle.artifact.length, sha256: bundle.artifactSha256 },
    minimalProofBufferReceiptSha256: bundle.minimal.sha256,
    deploymentPlanSha256: bundle.deploymentPlan.sha256,
    deploymentReceiptSha256: bundle.deploymentReceipt.sha256,
    handoffFinalReceiptSha256: bundle.handoffFinal.sha256,
    expectedProofBuffer: { bytes: bundle.proofRaw.length, sha256: bundle.proofRawSha256 },
    rpcUsed: false,
    signingUsed: false,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

async function selfTest() {
  const controller = new PublicKey(EXPECTED_CONTROLLER);
  const target = new PublicKey(EXPECTED_TARGET);
  const legacyAuthority = new PublicKey(EXPECTED_LEGACY_AUTHORITY);
  const payer = new PublicKey(EXPECTED_PAYER);
  const treasury = new PublicKey(EXPECTED_TREASURY);
  const proofBuffer = new PublicKey(Buffer.alloc(32, 29));
  const bundle = {
    ids: { controller, target, targetProgramdata: new PublicKey(EXPECTED_TARGET_PROGRAMDATA), legacyAuthority, payer, treasury },
    proofBuffer,
  };
  const upgrade = upgradeInstruction(bundle);
  const close = closeInstruction(bundle);
  assert.equal(upgrade.data.toString("hex"), "03000000");
  assert.equal(close.data.toString("hex"), "05000000");
  assert.deepEqual(upgrade.keys.map((entry) => entry.pubkey.toBase58()), [
    EXPECTED_TARGET_PROGRAMDATA,
    EXPECTED_TARGET,
    proofBuffer.toBase58(),
    EXPECTED_TREASURY,
    SYSVAR_RENT_PUBKEY.toBase58(),
    SYSVAR_CLOCK_PUBKEY.toBase58(),
    EXPECTED_LEGACY_AUTHORITY,
  ]);
  assert.deepEqual(close.keys.map((entry) => entry.pubkey.toBase58()), [proofBuffer.toBase58(), EXPECTED_TREASURY, EXPECTED_LEGACY_AUTHORITY]);
  const negativePacket = compileAction({ stage: NEGATIVE_STAGE, signers: [payer, legacyAuthority], instructions: [upgrade] }, PublicKey.default.toBase58());
  const closePacket = compileAction({ stage: CLOSE_STAGE, signers: [payer, legacyAuthority], instructions: [close] }, PublicKey.default.toBase58());
  const expectedRaw = expectedProofRaw(legacyAuthority);
  assert.equal(expectedRaw.length, 38);
  assert.equal(expectedRaw[37], 1);
  const source = await readFile(fileURLToPath(import.meta.url), "utf8");
  const forbiddenKeypairLoader = ["load", "Secure", "Keypair"].join("");
  assert(!source.includes(forbiddenKeypairLoader), "proof/close adapter contains a keypair fallback");
  assert.equal((source.match(/sendRawTransaction\(/gu) ?? []).length, 1, "proof/close adapter has more than one direct old-authority submission site");
  const runtime = await selfTestCeremonyRuntime();
  const result = {
    schema: "ameba-governance-devnet-v2-former-authority-boundary-self-test-v1",
    tags: { loaderUpgrade: upgrade.data.toString("hex"), loaderClose: close.data.toString("hex") },
    accountCounts: { loaderUpgrade: upgrade.keys.length, loaderClose: close.keys.length },
    packetBytes: { loaderUpgrade: negativePacket.packetBytes, loaderClose: closePacket.packetBytes },
    minimalProofBufferBytes: expectedRaw.length,
    exactlyOneDirectNegativeSubmissionSite: true,
    injectedSignerOnly: true,
    runtime,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

async function main() {
  const command = process.argv[2];
  if (!COMMANDS.has(command)) {
    process.stderr.write(usage());
    process.exitCode = 2;
    return;
  }
  switch (command) {
    case "self-test": await selfTest(); break;
    case "verify-evidence-offline": await verifyEvidenceOffline(); break;
    case "status": await status(); break;
    case "plan-next": await planNext(); break;
    case "execute-next": await executeNext(); break;
    default: throw new Error("unreachable command");
  }
}

main().catch((error) => {
  if (error instanceof RpcBackoffExit) {
    process.stderr.write(`${JSON.stringify({ controlledExit: "rpc-rate-limit", retryAfterMs: error.retryAfterMs })}\n`);
    process.exitCode = 75;
    return;
  }
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
