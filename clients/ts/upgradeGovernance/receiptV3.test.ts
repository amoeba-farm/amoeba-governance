import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import {
  BufferVerificationStatusV1,
  GateStatusV1,
  ProposalClassV1,
  ProposalStateV2,
  RELEASE1_ACCOUNT_VERSION_V1,
  STATE_CHECKPOINT_V1_DISCRIMINATOR,
  STATE_CHECKPOINT_V1_RESERVED_LEN,
  StateCheckpointPhaseV1,
  stateCheckpointDigestV1,
  stateCheckpointHardCombinedRootV1,
  type StateCheckpointV1,
} from "./release1.js";
import {
  RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
  VERIFICATION_BITMAP_BYTES_V1,
  artifactChunkCount,
  artifactChunkCountAllowEmpty,
  artifactMerkleRoot,
} from "./artifactMerkleV1.js";
import {
  decodeExecuteUpgradeV1,
  decodeExecuteUnfreezeV1,
  encodeExecuteUnfreezeV1,
  encodeExecuteUpgradeV1,
  type ExecuteUnfreezeV1,
  type ExecuteUpgradeV1,
} from "./release1LoaderInstructions.js";
import { encodeFreezeProposalV2, type FreezeProposalV2 } from "./release1LifecycleInstructions.js";
import { COMPUTE_BUDGET_PROGRAM_ID_V1, SYSTEM_PROGRAM_ID_V1 } from "./operator.js";
import {
  CLOCK_SYSVAR_ID,
  GOVERNED_UPGRADE_RECEIPT_V3_SCHEMA,
  INSTRUCTIONS_SYSVAR_ID,
  LOADER_V3_PROGRAM_ID,
  RECEIPT_FINALIZED_ACCOUNT_ROLES_V3,
  RENT_SYSVAR_ID,
  deriveExternalDonationDriftV3,
  externalDonationRootV3,
  externalObservationRootsV3,
  finalizeFinalizedAccountQueryV3,
  finalizeFrozenHistoryQueryV3,
  finalizeGovernedUpgradeReceiptV3,
  finalizeOldAuthorityRejectionQueryV3,
  finalizedAccountInventoryRootV3,
  frozenHistoryInventoryRootV3,
  oldAuthorityRejectionIdentityV3,
  receiptContentAddressedBlobV3,
  verifyGovernedUpgradeReceiptV3,
  verifyGovernedUpgradeReceiptV3AgainstFinalizedHistory,
  type GovernedUpgradeReceiptV3,
  type GovernedUpgradeReceiptV3Material,
  type ReceiptAccountMetaV3,
  type ReceiptCheckpointV3,
  type ReceiptExternalAccountObservationV3,
  type ReceiptExternalObservationSetV3,
  type ReceiptFinalizedAccountRoleV3,
  type ReceiptFinalizedAccountSnapshotV3,
  type ReceiptFrozenHistoryTransactionV3,
  type ReceiptHistoryInstructionV3,
  type ReceiptIdentitiesV3,
} from "./receiptV3.js";
import {
  deriveAuthorityPda,
  deriveControllerConfigPda,
  deriveCouncilPda,
  deriveGatePda,
  derivePolicyPda,
  deriveUpgradeableProgramdataAddress,
  PROTOCOL_GATE_DISCRIMINATOR,
  serializeProtocolGateV1,
} from "./v1.js";
import {
  CONTROLLER_CONFIG_V1_DISCRIMINATOR,
  V1_ACCOUNT_VERSION,
  serializeControllerConfigV1,
} from "./v1FixedAccounts.js";

const rawBytes = (value: number): Buffer => Buffer.alloc(32, value);
const key = (value: number): PublicKey => new PublicKey(rawBytes(value));
const hash = (value: Buffer): string => createHash("sha256").update(value).digest("hex");
const h = (value: number): string => rawBytes(value).toString("hex");
const decimal = (value: bigint | number): string => BigInt(value).toString();

function canonicalManifestJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalManifestJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([name, entry]) => `${JSON.stringify(name)}:${canonicalManifestJson(entry)}`).join(",")}}`;
}

function manifestBlob(value: unknown) {
  return receiptContentAddressedBlobV3(Buffer.from(canonicalManifestJson(value), "utf8"));
}

function trustInventoryRoot(domain: string, entries: readonly { name: string; sha256: string; bytes: Buffer }[]): string {
  const leaves = entries.map(({ name, sha256, bytes }, index) => {
    const indexBytes = Buffer.alloc(8); indexBytes.writeBigUInt64LE(BigInt(index));
    const nameLength = Buffer.alloc(8); nameLength.writeBigUInt64LE(BigInt(Buffer.byteLength(name, "utf8")));
    const bytesLength = Buffer.alloc(8); bytesLength.writeBigUInt64LE(BigInt(bytes.length));
    return createHash("sha256").update(`${domain}_ENTRY`, "ascii").update(indexBytes).update(nameLength).update(name, "utf8").update(Buffer.from(sha256, "hex")).update(bytesLength).update(bytes).digest("hex");
  });
  const count = Buffer.alloc(4); count.writeUInt32LE(leaves.length);
  const digest = createHash("sha256").update(domain, "ascii").update(count);
  leaves.forEach((leaf) => digest.update(Buffer.from(leaf, "hex")));
  return digest.digest("hex");
}

function bitmap(count: number): string {
  const result = Buffer.alloc(VERIFICATION_BITMAP_BYTES_V1);
  for (let index = 0; index < count; index += 1) result[Math.floor(index / 8)]! |= 1 << (index % 8);
  return result.toString("hex");
}

const identities: ReceiptIdentitiesV3 = (() => {
  const controller = key(2);
  const target = key(9);
  return {
    clusterDomainHex: h(1),
    controllerProgram: controller.toBase58(),
    controllerProgramdata: deriveUpgradeableProgramdataAddress(controller)[0].toBase58(),
    controllerConfig: deriveControllerConfigPda(controller, target)[0].toBase58(),
    policy: derivePolicyPda(controller, target, 1n)[0].toBase58(),
    protocolGate: deriveGatePda(controller, target)[0].toBase58(),
    proposal: key(6).toBase58(),
    counterpartProposal: key(7).toBase58(),
    creationCouncil: deriveCouncilPda(controller, target, 2n)[0].toBase58(),
    council: deriveCouncilPda(controller, target, 4n)[0].toBase58(),
    targetProgram: target.toBase58(),
    targetProgramdata: deriveUpgradeableProgramdataAddress(target)[0].toBase58(),
    authorityPda: deriveAuthorityPda(controller, target)[0].toBase58(),
    upgradeableLoader: LOADER_V3_PROGRAM_ID.toBase58(),
    canonicalSpillTreasury: key(12).toBase58(),
    payer: key(13).toBase58(),
    buffer: key(14).toBase58(),
    bufferVerification: key(15).toBase58(),
    counterpartBufferVerification: key(16).toBase58(),
    programdataVerification: key(17).toBase58(),
    prestateCheckpoint: key(18).toBase58(),
    poststateCheckpoint: key(19).toBase58(),
    emergencyFreezeObservation: key(71).toBase58(),
  };
})();

function meta(pubkey: string, isSigner: boolean, isWritable: boolean): ReceiptAccountMetaV3 {
  return { pubkey, isSigner, isWritable };
}

function emptyExternal(slot: bigint, block: number): ReceiptExternalObservationSetV3 {
  return {
    context: {
      commitment: "finalized",
      clusterDomainHex: identities.clusterDomainHex,
      slot: slot.toString(),
      blockHash: h(block),
      blockTimeUnix: (1_700_000_000n + slot).toString(),
    },
    accounts: [],
  };
}

interface CheckpointExternalEvidence {
  readonly metadataRoot: string;
  readonly rawBalanceRoot: string;
  readonly donationRoot?: string;
  readonly donationCount?: bigint;
}

function checkpoint(
  phase: typeof StateCheckpointPhaseV1.Prestate | typeof StateCheckpointPhaseV1.Poststate,
  checkpointKey: string,
  targetSlot: bigint,
  targetPayload: string,
  targetRaw: string,
  targetCapacity: bigint,
  observationSlot: bigint,
  finalizedSlot: bigint,
  external: CheckpointExternalEvidence,
): ReceiptCheckpointV3 {
  const value: StateCheckpointV1 = {
    discriminator: STATE_CHECKPOINT_V1_DISCRIMINATOR,
    accountVersion: RELEASE1_ACCOUNT_VERSION_V1,
    bump: 1,
    initialized: true,
    phase,
    controllerConfig: new PublicKey(identities.controllerConfig),
    proposal: new PublicKey(identities.proposal),
    emergencyResolution: PublicKey.default,
    subjectDigest: rawBytes(20),
    targetProgram: new PublicKey(identities.targetProgram),
    targetProgramdata: new PublicKey(identities.targetProgramdata),
    finalizedObservationSlot: observationSlot,
    gateEpoch: 3n,
    targetProgramdataSlot: targetSlot,
    targetPayloadCommitment: Buffer.from(targetPayload, "hex"),
    targetRawProgramdataCommitment: Buffer.from(targetRaw, "hex"),
    targetCapacity,
    programOwnedStateRoot: rawBytes(21),
    programOwnedStateCount: 10n,
    logicalCompressedStateRoot: rawBytes(22),
    logicalCompressedStateCount: 20n,
    semanticCustodyAccountingRoot: rawBytes(23),
    hardCombinedRoot: Buffer.alloc(32),
    externalMetadataObservationRoot: Buffer.from(external.metadataRoot, "hex"),
    externalRawBalanceObservationRoot: Buffer.from(external.rawBalanceRoot, "hex"),
    schemaIdentifier: rawBytes(26),
    admittedPositiveDonationRoot: Buffer.from(external.donationRoot ?? "0".repeat(64), "hex"),
    admittedPositiveDonationCount: external.donationCount ?? 0n,
    forbiddenDriftCount: 0,
    approvalCouncilVersion: 4n,
    approvalCouncilHash: rawBytes(27),
    checkpointDigest: Buffer.alloc(32),
    approvalBitset: 7,
    approvalCount: 3,
    accepted: true,
    finalizedSlot,
    reserved: Buffer.alloc(STATE_CHECKPOINT_V1_RESERVED_LEN),
  };
  value.hardCombinedRoot = stateCheckpointHardCombinedRootV1(value);
  value.checkpointDigest = stateCheckpointDigestV1(value);
  return {
    checkpoint: checkpointKey,
    phase: phase === StateCheckpointPhaseV1.Prestate ? "prestate" : "poststate",
    subjectDigest: value.subjectDigest.toString("hex"),
    finalizedObservationSlot: decimal(value.finalizedObservationSlot),
    gateEpoch: decimal(value.gateEpoch),
    targetProgramdataSlot: decimal(value.targetProgramdataSlot),
    targetPayloadCommitment: value.targetPayloadCommitment.toString("hex"),
    targetRawProgramdataCommitment: value.targetRawProgramdataCommitment.toString("hex"),
    targetCapacity: decimal(value.targetCapacity),
    programOwnedStateRoot: value.programOwnedStateRoot.toString("hex"),
    programOwnedStateCount: decimal(value.programOwnedStateCount),
    logicalCompressedStateRoot: value.logicalCompressedStateRoot.toString("hex"),
    logicalCompressedStateCount: decimal(value.logicalCompressedStateCount),
    semanticCustodyAccountingRoot: value.semanticCustodyAccountingRoot.toString("hex"),
    hardCombinedRoot: value.hardCombinedRoot.toString("hex"),
    externalMetadataObservationRoot: value.externalMetadataObservationRoot.toString("hex"),
    externalRawBalanceObservationRoot: value.externalRawBalanceObservationRoot.toString("hex"),
    schemaIdentifier: value.schemaIdentifier.toString("hex"),
    admittedPositiveDonationRoot: value.admittedPositiveDonationRoot.toString("hex"),
    admittedPositiveDonationCount: decimal(value.admittedPositiveDonationCount),
    forbiddenDriftCount: 0,
    approvalCouncilVersion: decimal(value.approvalCouncilVersion),
    approvalCouncilHash: value.approvalCouncilHash.toString("hex"),
    checkpointDigest: value.checkpointDigest.toString("hex"),
    approvalBitset: 7,
    approvalCount: 3,
    accepted: true,
    finalizedSlot: decimal(value.finalizedSlot),
  };
}

function historyInstruction(programId: string, dataHex: string, accounts: readonly ReceiptAccountMetaV3[] = []): ReceiptHistoryInstructionV3 {
  return { programId, dataHex, accounts };
}

function historyTransaction(
  slot: number,
  transactionIndex: number,
  topLevelInstructions: readonly ReceiptHistoryInstructionV3[],
  innerInstructions: readonly ReceiptHistoryInstructionV3[] = [],
): ReceiptFrozenHistoryTransactionV3 {
  return {
    slot: slot.toString(),
    blockHash: h(slot),
    blockTimeUnix: (1_700_000_000 + slot).toString(),
    transactionIndex,
    signatureHex: Buffer.alloc(64, transactionIndex + 1).toString("hex"),
    messageSha256: h(150 + transactionIndex),
    metaSha256: h(160 + transactionIndex),
    status: "succeeded",
    errorSha256: "0".repeat(64),
    topLevelInstructions,
    innerInstructionGroups: innerInstructions.length === 0 ? [] : [{ topLevelInstructionIndex: topLevelInstructions.length - 1, instructions: innerInstructions }],
  };
}

function controllerTrustRoot() {
  const controller = new PublicKey(identities.controllerProgram);
  const target = new PublicKey(identities.targetProgram);
  const [, configBump] = deriveControllerConfigPda(controller, target);
  const config = serializeControllerConfigV1({
    discriminator: CONTROLLER_CONFIG_V1_DISCRIMINATOR,
    version: V1_ACCOUNT_VERSION,
    bump: configBump,
    initialized: true,
    clusterDomain: Buffer.from(identities.clusterDomainHex, "hex"),
    targetProgram: target,
    targetProgramdata: new PublicKey(identities.targetProgramdata),
    upgradeableLoader: LOADER_V3_PROGRAM_ID,
    authorityPda: new PublicKey(identities.authorityPda),
    gatePda: new PublicKey(identities.protocolGate),
    canonicalSpillTreasury: new PublicKey(identities.canonicalSpillTreasury),
    currentCouncilVersion: 4n,
    currentPolicyVersion: 1n,
    nextProposalId: 9n,
    targetNonce: 6n,
    guardian: key(69),
    voteProgram: PublicKey.default,
    voteProgramdata: PublicKey.default,
    voteConfig: PublicKey.default,
    voteMint: PublicKey.default,
    tokenGovernanceEnabled: false,
    routineDelaySlots: 20n,
    majorDelaySlots: 30n,
    rollbackDelaySlots: 10n,
    terminalDelaySlots: 40n,
    voteReviewSlots: 20n,
    proposalExpirySlots: 151n,
    policyFlags: 0n,
    reserved: Buffer.alloc(28),
  });
  const artifact = Buffer.alloc(4_096);
  for (let index = 0; index < artifact.length; index += 1) artifact[index] = (index * 7) % 251;
  const capacity = 8_192;
  const raw = Buffer.alloc(45 + capacity);
  raw.writeUInt32LE(3, 0);
  raw.writeBigUInt64LE(77n, 4);
  raw[12] = 1;
  key(70).toBuffer().copy(raw, 13);
  artifact.copy(raw, 45);
  const programAccount = Buffer.alloc(36);
  programAccount.writeUInt32LE(2, 0);
  new PublicKey(identities.controllerProgramdata).toBuffer().copy(programAccount, 4);
  const artifactBlob = receiptContentAddressedBlobV3(artifact);
  const programAccountBlob = receiptContentAddressedBlobV3(programAccount);
  const rawProgramdataBlob = receiptContentAddressedBlobV3(raw);
  const initializationStateBlob = receiptContentAddressedBlobV3(config);
  const sourceFiles = [
    { name: "Cargo.lock", bytes: Buffer.from("locked dependency graph\n", "utf8") },
    { name: "src/lib.rs", bytes: Buffer.from("pub fn process_release1() {}\n", "utf8") },
  ].map((entry) => ({ ...entry, sha256: hash(entry.bytes) }));
  const sourceTreeRoot = trustInventoryRoot("AMOEBA_CONTROLLER_SOURCE_TREE_V1", sourceFiles);
  const sourceTree = manifestBlob({
    schema: "amoeba-controller-source-tree-v1",
    files: sourceFiles.map(({ name, sha256, bytes }) => ({ name, sha256, bytesBase64: bytes.toString("base64") })),
    treeRoot: sourceTreeRoot,
  });
  const sourceCommit = manifestBlob({
    schema: "amoeba-controller-source-commit-v1",
    commitId: "a".repeat(40),
    sourceTreeManifestSha256: sourceTree.sha256,
    sourceTreeRoot,
  });
  const exactAbiBytes = Buffer.from(canonicalManifestJson({ instructions: [], schema: "amoeba-controller-abi-v1" }), "utf8");
  const abi = manifestBlob({
    schema: "amoeba-controller-abi-manifest-v1",
    sourceCommitManifestSha256: sourceCommit.sha256,
    sourceTreeManifestSha256: sourceTree.sha256,
    sourceTreeRoot,
    abiSha256: hash(exactAbiBytes),
    abiBytesBase64: exactAbiBytes.toString("base64"),
  });
  const buildInputs = [
    { name: "Cargo.lock", bytes: Buffer.from("locked dependency graph\n", "utf8") },
    { name: "rust-toolchain.toml", bytes: Buffer.from("[toolchain]\nchannel = \"1.85.1\"\n", "utf8") },
  ].map((entry) => ({ ...entry, sha256: hash(entry.bytes) }));
  const buildInputInventory = manifestBlob({
    schema: "amoeba-controller-build-inputs-v1",
    sourceCommitManifestSha256: sourceCommit.sha256,
    sourceTreeManifestSha256: sourceTree.sha256,
    sourceTreeRoot,
    abiManifestSha256: abi.sha256,
    abiSha256: hash(exactAbiBytes),
    controllerArtifactSha256: artifactBlob.sha256,
    toolchain: { rustc: "rustc 1.85.1", solana: "solana-cli 2.3.8", sbpfVersion: "v2" },
    inputs: buildInputs.map(({ name, sha256, bytes }) => ({ name, sha256, bytesBase64: bytes.toString("base64") })),
    inputsRoot: trustInventoryRoot("AMOEBA_CONTROLLER_BUILD_INPUTS_V1", buildInputs),
  });
  const immutabilityPlan = manifestBlob({
    schema: "amoeba-controller-immutability-plan-v1",
    sourceCommitManifestSha256: sourceCommit.sha256,
    sourceTreeManifestSha256: sourceTree.sha256,
    sourceTreeRoot,
    abiManifestSha256: abi.sha256,
    abiSha256: hash(exactAbiBytes),
    buildInputInventoryManifestSha256: buildInputInventory.sha256,
    controllerArtifactSha256: artifactBlob.sha256,
    controllerProgram: identities.controllerProgram,
    controllerProgramdata: identities.controllerProgramdata,
    controllerProgramAccountSha256: programAccountBlob.sha256,
    controllerProgramdataRawSha256: rawProgramdataBlob.sha256,
    controllerProgramdataAuthority: key(70).toBase58(),
    initializationStateSha256: initializationStateBlob.sha256,
    currentControllerImmutable: false,
    intendedFinalControllerImmutable: true,
    status: "readiness-only",
  });
  return {
    sourceCommit,
    sourceTree,
    abi,
    buildInputInventory,
    controllerArtifact: artifactBlob,
    controllerProgramOwner: LOADER_V3_PROGRAM_ID.toBase58(),
    controllerProgramAccount: programAccountBlob,
    controllerProgramdata: {
      owner: LOADER_V3_PROGRAM_ID.toBase58(),
      deployedSlot: "77",
      capacity: capacity.toString(),
      authority: key(70).toBase58(),
      zeroTailRequired: true as const,
      rawProgramdata: rawProgramdataBlob,
    },
    initializationStateOwner: identities.controllerProgram,
    initializationState: initializationStateBlob,
    initialized: true as const,
    tokenGovernanceEnabled: false as const,
    controllerImmutable: false,
    immutabilityPlan,
    productionIdentityVerified: false,
  };
}

function finalizedRolePubkey(role: ReceiptFinalizedAccountRoleV3): string {
  switch (role) {
    case "controller-program": return identities.controllerProgram;
    case "controller-programdata": return identities.controllerProgramdata;
    case "controller-config": return identities.controllerConfig;
    case "policy": return identities.policy;
    case "protocol-gate": return identities.protocolGate;
    case "proposal": return identities.proposal;
    case "counterpart-proposal": return identities.counterpartProposal;
    case "creation-council": return identities.creationCouncil;
    case "current-council": return identities.council;
    case "prestate-checkpoint": return identities.prestateCheckpoint;
    case "poststate-checkpoint": return identities.poststateCheckpoint;
    case "buffer": return identities.buffer;
    case "buffer-verification": return identities.bufferVerification;
    case "counterpart-buffer-verification": return identities.counterpartBufferVerification;
    case "programdata-verification": return identities.programdataVerification;
    case "emergency-freeze-observation": return identities.emergencyFreezeObservation;
    case "target-program": return identities.targetProgram;
    case "target-programdata": return identities.targetProgramdata;
  }
}

function finalizedSnapshot(
  role: ReceiptFinalizedAccountRoleV3,
  data: Buffer | null,
  owner = identities.controllerProgram,
  executable = false,
): ReceiptFinalizedAccountSnapshotV3 {
  if (data === null) return {
    role,
    pubkey: finalizedRolePubkey(role),
    exists: false,
    owner: null,
    executable: null,
    lamports: null,
    dataLength: 0,
    dataSha256: "0".repeat(64),
    dataBase64: null,
  };
  return {
    role,
    pubkey: finalizedRolePubkey(role),
    exists: true,
    owner,
    executable,
    lamports: "1000000",
    dataLength: data.length,
    dataSha256: hash(data),
    dataBase64: data.toString("base64"),
  };
}

function finalizedAccountEvidence(
  trust: ReturnType<typeof controllerTrustRoot>,
  targetRawProgramdata: Buffer,
) {
  const [, gateBump] = deriveGatePda(new PublicKey(identities.controllerProgram), new PublicKey(identities.targetProgram));
  const gate = serializeProtocolGateV1({
    discriminator: PROTOCOL_GATE_DISCRIMINATOR,
    accountVersion: 1,
    bump: gateBump,
    initialized: true,
    status: GateStatusV1.Active,
    controllerConfig: new PublicKey(identities.controllerConfig),
    targetProgram: new PublicKey(identities.targetProgram),
    targetProgramdata: new PublicKey(identities.targetProgramdata),
    epoch: 4n,
    activeProposal: PublicKey.default,
    freezeSlot: 0n,
    freezeReasonCode: 0,
    lastCompletedProposal: new PublicKey(identities.proposal),
    reserved: Buffer.alloc(2),
  });
  const targetProgram = Buffer.alloc(36);
  targetProgram.writeUInt32LE(2, 0);
  new PublicKey(identities.targetProgramdata).toBuffer().copy(targetProgram, 4);
  const exactData = new Map<ReceiptFinalizedAccountRoleV3, Buffer | null>([
    ["controller-program", Buffer.from(trust.controllerProgramAccount.bytesBase64, "base64")],
    ["controller-programdata", Buffer.from(trust.controllerProgramdata.rawProgramdata.bytesBase64, "base64")],
    ["controller-config", Buffer.from(trust.initializationState.bytesBase64, "base64")],
    ["protocol-gate", gate],
    ["buffer", null],
    ["emergency-freeze-observation", null],
    ["target-program", targetProgram],
    ["target-programdata", targetRawProgramdata],
  ]);
  const snapshots = RECEIPT_FINALIZED_ACCOUNT_ROLES_V3.map((role, index) => {
    const data = exactData.has(role) ? exactData.get(role)! : Buffer.from(`finalized:${index}:${role}`, "utf8");
    const loaderOwned = role === "controller-program" || role === "controller-programdata" || role === "target-program" || role === "target-programdata";
    return finalizedSnapshot(role, data, loaderOwned ? LOADER_V3_PROGRAM_ID.toBase58() : identities.controllerProgram, role === "controller-program" || role === "target-program");
  });
  const query = finalizeFinalizedAccountQueryV3({
    context: {
      commitment: "finalized",
      clusterDomainHex: identities.clusterDomainHex,
      slot: "130",
      blockHash: h(130),
      blockTimeUnix: "1700000130",
    },
    accounts: RECEIPT_FINALIZED_ACCOUNT_ROLES_V3.map((role) => ({ role, pubkey: finalizedRolePubkey(role) })),
  });
  return { query, snapshots, inventoryRoot: finalizedAccountInventoryRootV3(snapshots) };
}

function oldAuthorityRejectionEvidence() {
  const oldAuthority = key(49).toBase58();
  const attemptedBuffer = key(81).toBase58();
  const transaction = historyTransaction(125, 9, [historyInstruction(LOADER_V3_PROGRAM_ID.toBase58(), "03000000", [
    meta(identities.targetProgramdata, false, true),
    meta(identities.targetProgram, false, true),
    meta(attemptedBuffer, false, true),
    meta(identities.canonicalSpillTreasury, false, true),
    meta(RENT_SYSVAR_ID.toBase58(), false, false),
    meta(CLOCK_SYSVAR_ID.toBase58(), false, false),
    meta(oldAuthority, true, false),
  ])]);
  transaction.status = "failed";
  transaction.errorSha256 = h(201);
  const query = finalizeOldAuthorityRejectionQueryV3({
    commitment: "finalized",
    clusterDomainHex: identities.clusterDomainHex,
    slot: transaction.slot,
    signatureHex: transaction.signatureHex,
    targetProgram: identities.targetProgram,
    targetProgramdata: identities.targetProgramdata,
    controllerAuthority: identities.authorityPda,
    oldAuthority,
    attemptedBuffer,
    spillTreasury: identities.canonicalSpillTreasury,
  });
  const programdataAuthority = identities.authorityPda;
  return {
    query,
    programdataAuthority,
    transaction,
    deterministicIdentity: oldAuthorityRejectionIdentityV3(query, programdataAuthority, transaction),
  };
}

function validReceipt(): GovernedUpgradeReceiptV3 {
  const artifact = Buffer.alloc(20_000);
  for (let index = 0; index < artifact.length; index += 1) artifact[index] = index % 251;
  const artifactSha = hash(artifact);
  const merkleRoot = artifactMerkleRoot(artifact).toString("hex");
  const capacity = 40_000;
  const rawProgramdata = Buffer.alloc(45 + capacity);
  rawProgramdata.writeUInt32LE(3, 0);
  rawProgramdata.writeBigUInt64LE(100n, 4);
  rawProgramdata[12] = 1;
  new PublicKey(identities.authorityPda).toBuffer().copy(rawProgramdata, 13);
  artifact.copy(rawProgramdata, 45);
  const rawProgramdataSha = hash(rawProgramdata);
  const externalPrestate = emptyExternal(92n, 72);
  const externalPoststate = emptyExternal(108n, 73);
  const preRoots = externalObservationRootsV3(externalPrestate);
  const postRoots = externalObservationRootsV3(externalPoststate);
  const prestate = checkpoint(StateCheckpointPhaseV1.Prestate, identities.prestateCheckpoint, 80n, h(30), h(31), BigInt(capacity), 92n, 93n, { metadataRoot: preRoots.metadataRoot, rawBalanceRoot: preRoots.rawBalanceRoot });
  const poststate = checkpoint(StateCheckpointPhaseV1.Poststate, identities.poststateCheckpoint, 100n, artifactSha, rawProgramdataSha, BigInt(capacity), 108n, 109n, { metadataRoot: postRoots.metadataRoot, rawBalanceRoot: postRoots.rawBalanceRoot });

  const execute: ExecuteUpgradeV1 = {
    expected: {
      expectedProposalDigest: rawBytes(20),
      expectedPolicyVersion: 1n,
      expectedPolicyHash: rawBytes(32),
      expectedCouncilVersion: 2n,
      expectedCouncilHash: rawBytes(33),
      expectedGateStatus: GateStatusV1.FrozenForUpgrade,
      expectedGateEpoch: 3n,
      expectedTargetNonce: 6n,
      expectedState: ProposalStateV2.Frozen,
      expectedReviewStartSlot: 50n,
      expectedReviewEndSlot: 70n,
      expectedNotBeforeSlot: 90n,
      expectedExpirySlot: 200n,
    },
    expectedPrestateCheckpointDigest: Buffer.from(prestate.checkpointDigest, "hex"),
    expectedCurrentRawProgramdataHash: rawBytes(31),
    expectedSealedBufferHeaderHash: rawBytes(34),
    expectedCounterpartProposalDigest: rawBytes(35),
    expectedProgramdataSlot: 80n,
    expectedCapacity: BigInt(capacity),
    expectedVerifiedChunkCount: artifactChunkCount(artifact.length, RELEASE1_ARTIFACT_CHUNK_SIZE_V1),
    expectedBufferVerificationStatus: BufferVerificationStatusV1.Verified,
    expectedCounterpartBufferVerificationStatus: BufferVerificationStatusV1.Verified,
    envelope: {
      computeUnitLimit: 1_200_000,
      computeUnitPriceMicroLamports: 17n,
      durableNonceAccount: { present: false, value: PublicKey.default },
      durableNonceAuthority: { present: false, value: PublicKey.default },
    },
  };
  const controllerData = encodeExecuteUpgradeV1(execute);
  const limit = Buffer.alloc(5); limit[0] = 2; limit.writeUInt32LE(1_200_000, 1);
  const price = Buffer.alloc(9); price[0] = 3; price.writeBigUInt64LE(17n, 1);
  const controllerAccounts = [
    meta(identities.payer, true, true), meta(identities.controllerConfig, false, false), meta(identities.policy, false, false), meta(identities.protocolGate, false, false),
    meta(identities.proposal, false, true), meta(identities.counterpartProposal, false, false), meta(identities.counterpartBufferVerification, false, false),
    meta(identities.prestateCheckpoint, false, false), meta(identities.bufferVerification, false, true), meta(identities.programdataVerification, false, true),
    meta(identities.targetProgramdata, false, true), meta(identities.targetProgram, false, true), meta(identities.buffer, false, true), meta(identities.canonicalSpillTreasury, false, true),
    meta(RENT_SYSVAR_ID.toBase58(), false, false), meta(CLOCK_SYSVAR_ID.toBase58(), false, false), meta(identities.authorityPda, false, false),
    meta(identities.upgradeableLoader, false, false), meta(SYSTEM_PROGRAM_ID_V1.toBase58(), false, false), meta(INSTRUCTIONS_SYSVAR_ID.toBase58(), false, false),
  ];
  const topLevelEnvelope = [
    { kind: "compute-unit-limit" as const, programId: COMPUTE_BUDGET_PROGRAM_ID_V1.toBase58(), dataHex: limit.toString("hex"), accounts: [] },
    { kind: "compute-unit-price" as const, programId: COMPUTE_BUDGET_PROGRAM_ID_V1.toBase58(), dataHex: price.toString("hex"), accounts: [] },
    { kind: "controller-execute-upgrade" as const, programId: identities.controllerProgram, dataHex: controllerData.toString("hex"), accounts: controllerAccounts },
  ];
  const innerCpis = [{
    kind: "loader-upgrade" as const,
    programId: LOADER_V3_PROGRAM_ID.toBase58(),
    dataHex: "03000000",
    accounts: [
      meta(identities.targetProgramdata, false, true), meta(identities.targetProgram, false, true), meta(identities.buffer, false, true),
      meta(identities.canonicalSpillTreasury, false, true), meta(RENT_SYSVAR_ID.toBase58(), false, false), meta(CLOCK_SYSVAR_ID.toBase58(), false, false),
      meta(identities.authorityPda, true, false),
    ],
  }];
  const freeze: FreezeProposalV2 = {
    expected: {
      expectedProposalDigest: rawBytes(20),
      expectedPolicyVersion: 1n,
      expectedPolicyHash: rawBytes(32),
      expectedCouncilVersion: 2n,
      expectedCouncilHash: rawBytes(33),
      expectedGateStatus: GateStatusV1.Active,
      expectedGateEpoch: 2n,
      expectedTargetNonce: 5n,
      expectedState: ProposalStateV2.Timelocked,
      expectedReviewStartSlot: 50n,
      expectedReviewEndSlot: 70n,
      expectedNotBeforeSlot: 90n,
      expectedExpirySlot: 200n,
    },
    expectedNextGateEpoch: 3n,
  };
  const freezeInstruction = historyInstruction(identities.controllerProgram, encodeFreezeProposalV2(freeze).toString("hex"), [
    meta(identities.controllerConfig, false, true), meta(identities.policy, false, false), meta(identities.creationCouncil, false, false),
    meta(identities.protocolGate, false, true), meta(identities.proposal, false, true), meta(identities.targetProgram, false, false),
    meta(identities.targetProgramdata, false, false), meta(identities.upgradeableLoader, false, false), meta(identities.authorityPda, false, false),
    meta(identities.counterpartProposal, false, false), meta(identities.counterpartBufferVerification, false, false), meta(identities.buffer, false, false),
  ]);
  const unfreeze: ExecuteUnfreezeV1 = {
    expected: {
      expectedProposalDigest: rawBytes(20),
      expectedPolicyVersion: 1n,
      expectedPolicyHash: rawBytes(32),
      expectedCurrentCouncilVersion: 4n,
      expectedCurrentCouncilHash: rawBytes(27),
      expectedFrozenGateEpoch: 3n,
      expectedTargetNonce: 6n,
      expectedProposalState: ProposalStateV2.UnfreezeApproved,
      expectedPoststateCheckpointDigest: Buffer.from(poststate.checkpointDigest, "hex"),
      expectedProgramdataAuthority: new PublicKey(identities.authorityPda),
      expectedProgramdataDeployedSlot: 100n,
      expectedProgramdataCapacity: BigInt(capacity),
      expectedRawProgramdataHash: Buffer.from(rawProgramdataSha, "hex"),
      expectedUnfreezeApprovalBitset: 7,
      expectedUnfreezeApprovalCount: 3,
      expectedProgramdataVerificationFinalizedSlot: 107n,
    },
    linkedProposal: new PublicKey(identities.counterpartProposal),
    envelope: {
      computeUnitLimit: 1_200_000,
      computeUnitPriceMicroLamports: 17n,
      durableNonceAccount: { present: false, value: PublicKey.default },
      durableNonceAuthority: { present: false, value: PublicKey.default },
    },
  };
  const unfreezeInstruction = historyInstruction(identities.controllerProgram, encodeExecuteUnfreezeV1(unfreeze).toString("hex"), [
    meta(identities.controllerConfig, false, false), meta(identities.policy, false, false), meta(identities.council, false, false),
    meta(identities.protocolGate, false, true), meta(identities.proposal, false, true), meta(identities.counterpartProposal, false, true),
    meta(identities.poststateCheckpoint, false, false), meta(identities.programdataVerification, false, false),
    meta(identities.targetProgram, false, false), meta(identities.targetProgramdata, false, false), meta(identities.authorityPda, false, false),
    meta(identities.upgradeableLoader, false, false), meta(INSTRUCTIONS_SYSVAR_ID.toBase58(), false, false),
  ]);
  const historyTransactions = [
    historyTransaction(90, 0, [freezeInstruction]),
    historyTransaction(100, 1, topLevelEnvelope.map(({ programId, dataHex, accounts }) => historyInstruction(programId, dataHex, accounts)), innerCpis.map(({ programId, dataHex, accounts }) => historyInstruction(programId, dataHex, accounts))),
    historyTransaction(120, 2, [
      historyInstruction(COMPUTE_BUDGET_PROGRAM_ID_V1.toBase58(), limit.toString("hex")),
      historyInstruction(COMPUTE_BUDGET_PROGRAM_ID_V1.toBase58(), price.toString("hex")),
      unfreezeInstruction,
    ]),
  ];
  const historyQuery = finalizeFrozenHistoryQueryV3({
    commitment: "finalized",
    clusterDomainHex: identities.clusterDomainHex,
    startSlot: "90",
    endSlot: "120",
    matchMode: "any-account-key",
    includeFailed: true,
    addresses: [
      identities.controllerProgram, identities.targetProgram, identities.targetProgramdata, identities.authorityPda,
      identities.protocolGate, identities.proposal, identities.buffer,
    ].sort((left, right) => Buffer.compare(new PublicKey(left).toBuffer(), new PublicKey(right).toBuffer())),
  });
  const trustRoot = controllerTrustRoot();
  const material: GovernedUpgradeReceiptV3Material = {
    schema: GOVERNED_UPGRADE_RECEIPT_V3_SCHEMA,
    version: 3,
    production: false,
    identities: { ...identities },
    topLevelEnvelope,
    innerCpis,
    governance: {
      proposalDigest: h(20), counterpartProposalDigest: h(35), proposalClass: ProposalClassV1.RoutineUpgrade,
      policyVersion: "1", policyHash: h(32), routineDelaySlots: "20", majorDelaySlots: "30", rollbackDelaySlots: "10", councilReviewSlots: "20", proposalExpirySlots: "151",
      creationCouncilVersion: "2", creationCouncilHash: h(33), currentCouncilVersion: "4", currentCouncilHash: h(27),
      proposalApprovalBitset: 7, proposalApprovalCount: 3, poststateApprovalBitset: 7, poststateApprovalCount: 3, unfreezeApprovalBitset: 7, unfreezeApprovalCount: 3,
      proposalTargetNonce: "5", configTargetNonceAfterFreeze: "6", freezeTransition: "ordinary", creationGateStatus: GateStatusV1.Active,
      creationGateEpoch: "2", frozenGateEpoch: "3", completedGateEpoch: "4", creationSlot: "49", reviewStartSlot: "50", reviewEndSlot: "70", notBeforeSlot: "90",
      expirySlot: "200", firstApprovalSlot: "60", councilApprovedSlot: "65", governanceSatisfiedSlot: "66", queuedSlot: "67", freezeSlot: "90", extensionSlot: "0",
      upgradeSlot: "100", programdataVerifiedSlot: "107", poststateAcceptedSlot: "110", unfreezeApprovedSlot: "115", unfreezeSlot: "120",
      preProgramdataSlot: "80", preProgramdataCapacity: decimal(capacity), preRawProgramdataHash: h(31),
      transitions: ["Draft", "BufferAdopted", "BufferVerified", "CouncilApproved", "GovernanceSatisfied", "Timelocked", "Frozen", "UpgradeExecuted", "ProgramDataVerified", "PoststateAccepted", "UnfreezeApproved", "Completed"],
    },
    buffer: {
      initialOwner: LOADER_V3_PROGRAM_ID.toBase58(), initialUploaderAuthority: key(40).toBase58(), finalAuthority: identities.authorityPda, sealedBufferHeaderHash: h(34),
      adoptedSlot: "52", verificationFinalizedSlot: "55", sealedThroughSlot: "100", artifactLength: decimal(artifact.length), artifactSha256: artifactSha,
      artifactChunkMerkleRoot: merkleRoot, chunkSize: RELEASE1_ARTIFACT_CHUNK_SIZE_V1, chunkCount: artifactChunkCount(artifact.length, RELEASE1_ARTIFACT_CHUNK_SIZE_V1),
      verifiedChunkBitmapHex: bitmap(artifactChunkCount(artifact.length, RELEASE1_ARTIFACT_CHUNK_SIZE_V1)), verifiedChunkCount: artifactChunkCount(artifact.length, RELEASE1_ARTIFACT_CHUNK_SIZE_V1),
      status: "verified", result: "consumed-by-upgrade", artifactBytesBase64: artifact.toString("base64"),
    },
    programdata: {
      owner: LOADER_V3_PROGRAM_ID.toBase58(), deployedSlot: "100", capacity: decimal(capacity), authority: identities.authorityPda,
      artifactLength: decimal(artifact.length), payloadSha256: artifactSha, artifactChunkMerkleRoot: merkleRoot, rawProgramdataSha256: rawProgramdataSha,
      rawProgramdataBytesBase64: rawProgramdata.toString("base64"), verifiedPayloadChunkBitmapHex: bitmap(artifactChunkCount(artifact.length, RELEASE1_ARTIFACT_CHUNK_SIZE_V1)),
      verifiedPayloadChunkCount: artifactChunkCount(artifact.length, RELEASE1_ARTIFACT_CHUNK_SIZE_V1), verifiedTailChunkBitmapHex: bitmap(artifactChunkCountAllowEmpty(capacity - artifact.length, RELEASE1_ARTIFACT_CHUNK_SIZE_V1)),
      verifiedTailChunkCount: artifactChunkCountAllowEmpty(capacity - artifact.length, RELEASE1_ARTIFACT_CHUNK_SIZE_V1), zeroTailRequired: true, zeroTailVerified: true,
      verificationFinalizedSlot: "107",
    },
    state: { prestate, poststate, externalPrestate, externalPoststate },
    frozenHistory: { query: historyQuery, transactions: historyTransactions, inventoryRoot: frozenHistoryInventoryRootV3(historyTransactions) },
    finalizedAccounts: finalizedAccountEvidence(trustRoot, rawProgramdata),
    controllerTrustRoot: trustRoot,
    handoff: {
      performed: false, simulated: true, authorityBefore: key(49).toBase58(), authorityAfter: identities.authorityPda, oldAuthority: key(49).toBase58(),
      oldAuthorityRejection: oldAuthorityRejectionEvidence(),
    },
  };
  return finalizeGovernedUpgradeReceiptV3(material);
}

function changed(receipt: GovernedUpgradeReceiptV3, mutate: (material: GovernedUpgradeReceiptV3Material) => void): GovernedUpgradeReceiptV3 {
  const copy = JSON.parse(JSON.stringify(receipt)) as GovernedUpgradeReceiptV3;
  const { receiptDigest: _digest, ...material } = copy;
  mutate(material);
  return finalizeGovernedUpgradeReceiptV3(material);
}

function replaceFinalizedSnapshotData(
  material: GovernedUpgradeReceiptV3Material,
  role: ReceiptFinalizedAccountRoleV3,
  data: Buffer,
): void {
  material.finalizedAccounts.snapshots = material.finalizedAccounts.snapshots.map((snapshot) => snapshot.role === role ? {
    ...snapshot,
    dataLength: data.length,
    dataSha256: hash(data),
    dataBase64: data.toString("base64"),
  } : snapshot);
  material.finalizedAccounts.inventoryRoot = finalizedAccountInventoryRootV3(material.finalizedAccounts.snapshots);
}

function tokenObservation(amount: bigint, semanticMutation = false): ReceiptExternalAccountObservationV3 {
  const tokenProgram = key(60);
  const mint = key(61);
  const authority = key(62);
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);
  authority.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data[108] = 1;
  if (semanticMutation) data[120] = 1;
  const normalized = Buffer.from(data);
  normalized.fill(0, 64, 72);
  return {
    account: key(59).toBase58(),
    owner: tokenProgram.toBase58(),
    executable: false,
    lamports: "2039280",
    dataLength: data.length,
    dataSha256: hash(data),
    dataBase64: data.toString("base64"),
    assetKind: "token",
    tokenProgram: tokenProgram.toBase58(),
    mint: mint.toBase58(),
    authority: authority.toBase58(),
    tokenState: "initialized",
    rawTokenAmount: amount.toString(),
    normalizedSemanticSha256: hash(normalized),
  };
}

function withTokenDonation(receipt: GovernedUpgradeReceiptV3, beforeAmount = 100n, afterAmount = 125n): GovernedUpgradeReceiptV3 {
  return changed(receipt, (value) => {
    const externalPrestate: ReceiptExternalObservationSetV3 = { ...value.state.externalPrestate, accounts: [tokenObservation(beforeAmount)] };
    const externalPoststate: ReceiptExternalObservationSetV3 = { ...value.state.externalPoststate, accounts: [tokenObservation(afterAmount)] };
    const donations = deriveExternalDonationDriftV3(externalPrestate, externalPoststate);
    const preRoots = externalObservationRootsV3(externalPrestate);
    const postRoots = externalObservationRootsV3(externalPoststate);
    value.state = {
      externalPrestate,
      externalPoststate,
      prestate: checkpoint(StateCheckpointPhaseV1.Prestate, identities.prestateCheckpoint, 80n, h(30), h(31), BigInt(value.programdata.capacity), 92n, 93n, { metadataRoot: preRoots.metadataRoot, rawBalanceRoot: preRoots.rawBalanceRoot }),
      poststate: checkpoint(StateCheckpointPhaseV1.Poststate, identities.poststateCheckpoint, 100n, value.programdata.payloadSha256, value.programdata.rawProgramdataSha256, BigInt(value.programdata.capacity), 108n, 109n, {
        metadataRoot: postRoots.metadataRoot,
        rawBalanceRoot: postRoots.rawBalanceRoot,
        donationRoot: externalDonationRootV3(donations),
        donationCount: BigInt(donations.length),
      }),
    };
    const controller = value.topLevelEnvelope.at(-1)!;
    const decoded = decodeExecuteUpgradeV1(Buffer.from(controller.dataHex, "hex"));
    decoded.expectedPrestateCheckpointDigest = Buffer.from(value.state.prestate.checkpointDigest, "hex");
    controller.dataHex = encodeExecuteUpgradeV1(decoded).toString("hex");
    const upgradeTransaction = value.frozenHistory.transactions[1]!;
    upgradeTransaction.topLevelInstructions[2]!.dataHex = controller.dataHex;
    const unfreezeTransaction = value.frozenHistory.transactions[2]!;
    const unfreeze = decodeExecuteUnfreezeV1(Buffer.from(unfreezeTransaction.topLevelInstructions[2]!.dataHex, "hex"));
    unfreeze.expected.expectedPoststateCheckpointDigest = Buffer.from(value.state.poststate.checkpointDigest, "hex");
    unfreezeTransaction.topLevelInstructions[2]!.dataHex = encodeExecuteUnfreezeV1(unfreeze).toString("hex");
    value.frozenHistory.inventoryRoot = frozenHistoryInventoryRootV3(value.frozenHistory.transactions);
  });
}

test("receipt v3 independently verifies the governed lifecycle and content evidence", () => {
  const receipt = validReceipt();
  const result = verifyGovernedUpgradeReceiptV3(receipt);
  assert.equal(result.valid, true);
  assert.equal(result.receiptDigest, receipt.receiptDigest);
  assert.equal(result.artifactSha256, receipt.buffer.artifactSha256);
  assert.equal(result.rawProgramdataSha256, receipt.programdata.rawProgramdataSha256);
  assert.equal(result.admittedDonationCount, 0);
  assert.equal(result.finalizedSourceVerification, "receipt-evidence-only");
});

test("receipt v3 preserves exact envelope, governance, checkpoint, byte, and timing checks", () => {
  const receipt = validReceipt();
  assert.throws(() => verifyGovernedUpgradeReceiptV3({ ...receipt, production: true }), /predeployment-r4 schema cannot assert/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => { value.topLevelEnvelope = [...value.topLevelEnvelope, value.topLevelEnvelope.at(-1)!]; })), /topLevelEnvelope/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => { value.innerCpis[0]!.accounts[3]!.pubkey = key(90).toBase58(); })), /innerCpis/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => { value.governance.proposalApprovalBitset = 3; value.governance.proposalApprovalCount = 2; })), /3-of-5/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => { value.governance.configTargetNonceAfterFreeze = "8"; })), /consume exactly one/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => { value.buffer.verifiedChunkBitmapHex = "00".repeat(64); })), /bitmap/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => { value.governance.firstApprovalSlot = "49"; })), /approval, governance-satisfaction, or queue timing/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => { value.governance.routineDelaySlots = "19"; })), /class-selected policy/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => { value.state.poststate.programOwnedStateRoot = h(88); })), /hardCombinedRoot|hard protected/u);
});

test("receipt v3 rejects altered sealed bytes and ProgramData shortcuts", () => {
  const receipt = validReceipt();
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => { const bytes = Buffer.from(value.buffer.artifactBytesBase64, "base64"); bytes[0] ^= 1; value.buffer.artifactBytesBase64 = bytes.toString("base64"); })), /artifact SHA-256 or Merkle/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => { const raw = Buffer.from(value.programdata.rawProgramdataBytesBase64, "base64"); raw[45] ^= 1; value.programdata.rawProgramdataBytesBase64 = raw.toString("base64"); })), /deployed payload bytes/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => { const raw = Buffer.from(value.programdata.rawProgramdataBytesBase64, "base64"); raw[raw.length - 1] = 1; value.programdata.rawProgramdataBytesBase64 = raw.toString("base64"); })), /zero tail/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => { value.programdata.rawProgramdataSha256 = h(99); })), /raw ProgramData SHA/u);
});

test("finalized account snapshots reject omissions, role drift, owner drift, and raw ProgramData substitution", () => {
  const receipt = validReceipt();
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => {
    value.finalizedAccounts.snapshots = value.finalizedAccounts.snapshots.slice(1);
    value.finalizedAccounts.inventoryRoot = finalizedAccountInventoryRootV3(value.finalizedAccounts.snapshots);
  })), /every canonical finalized account snapshot/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => {
    const { queryIdentity: _queryIdentity, ...query } = value.finalizedAccounts.query;
    value.finalizedAccounts.query = finalizeFinalizedAccountQueryV3({ ...query, accounts: [...query.accounts].reverse() });
  })), /omission, addition, reordering, or identity drift/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => {
    const snapshot = value.finalizedAccounts.snapshots.find((entry) => entry.role === "policy")!;
    snapshot.owner = LOADER_V3_PROGRAM_ID.toBase58();
    value.finalizedAccounts.inventoryRoot = finalizedAccountInventoryRootV3(value.finalizedAccounts.snapshots);
  })), /owner or executable state is not canonical/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => {
    const snapshot = value.finalizedAccounts.snapshots.find((entry) => entry.role === "policy")!;
    (snapshot as unknown as Record<string, unknown>).exists = "true";
    value.finalizedAccounts.inventoryRoot = finalizedAccountInventoryRootV3(value.finalizedAccounts.snapshots);
  })), /exists: must be a boolean/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => {
    const raw = Buffer.from(value.programdata.rawProgramdataBytesBase64, "base64");
    raw[45] ^= 1;
    replaceFinalizedSnapshotData(value, "target-programdata", raw);
  })), /does not match the mechanically verified target ProgramData bytes/u);
});

test("external donations are derived from canonical pre/post observations, never booleans or caller deltas", () => {
  const receipt = withTokenDonation(validReceipt());
  assert.equal(verifyGovernedUpgradeReceiptV3(receipt).admittedDonationCount, 1);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => {
    (value.state as unknown as Record<string, unknown>).admittedPositiveDonations = [{ previouslyKnownAccount: true, identityUnchanged: true, positiveDeltaAtoms: "999" }];
  })), /unknown schema fields/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => {
    (value.state.externalPoststate.accounts[0] as unknown as Record<string, unknown>).positiveDeltaAtoms = "999";
  })), /unknown schema fields/u);
  assert.throws(() => withTokenDonation(validReceipt(), 125n, 100n), /negative token delta/u);
});

test("external inventory rejects omission, identity mutation, semantic mutation, and unsorted duplicates", () => {
  const pre: ReceiptExternalObservationSetV3 = { ...emptyExternal(92n, 72), accounts: [tokenObservation(100n)] };
  const post: ReceiptExternalObservationSetV3 = { ...emptyExternal(108n, 73), accounts: [tokenObservation(125n)] };
  assert.throws(() => deriveExternalDonationDriftV3(pre, { ...post, accounts: [] }), /omission or addition/u);
  assert.throws(() => deriveExternalDonationDriftV3(pre, { ...post, accounts: [{ ...post.accounts[0]!, authority: key(63).toBase58() }] }), /authority does not match raw|identity/u);
  assert.throws(() => deriveExternalDonationDriftV3(pre, { ...post, accounts: [tokenObservation(125n, true)] }), /semantic state changed/u);
  assert.throws(() => externalObservationRootsV3({ ...pre, accounts: [pre.accounts[0]!, pre.accounts[0]!] }), /strictly sorted.*duplicates/u);
});

test("frozen history derives tags and Loader CPI from exact ordered instruction evidence", () => {
  const receipt = validReceipt();
  assert.equal(receipt.frozenHistory.query.addresses.includes(LOADER_V3_PROGRAM_ID.toBase58()), false);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => {
    const { queryIdentity: _queryIdentity, ...query } = value.frozenHistory.query;
    value.frozenHistory.query = finalizeFrozenHistoryQueryV3({
      ...query,
      addresses: [...query.addresses, LOADER_V3_PROGRAM_ID.toBase58()].sort((left, right) => Buffer.compare(new PublicKey(left).toBuffer(), new PublicKey(right).toBuffer())),
    });
  })), /exact relevant address inventory/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => { value.frozenHistory.transactions = value.frozenHistory.transactions.filter((_, index) => index !== 1); })), /inventoryRoot/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => {
    value.frozenHistory.transactions[1]!.topLevelInstructions = [...value.frozenHistory.transactions[1]!.topLevelInstructions, historyInstruction(value.identities.targetProgram, "01")];
    value.frozenHistory.inventoryRoot = frozenHistoryInventoryRootV3(value.frozenHistory.transactions);
  })), /sibling arbitrary/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => {
    value.frozenHistory.transactions[1]!.innerInstructionGroups[0]!.instructions[0]!.accounts[3]!.pubkey = key(88).toBase58();
    value.frozenHistory.inventoryRoot = frozenHistoryInventoryRootV3(value.frozenHistory.transactions);
  })), /exact verified Loader CPI/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => {
    value.frozenHistory.transactions[0]!.topLevelInstructions[0]!.accounts[2]!.pubkey = value.identities.council;
    value.frozenHistory.inventoryRoot = frozenHistoryInventoryRootV3(value.frozenHistory.transactions);
  })), /account identity or privilege mismatch/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => {
    const data = Buffer.from(value.frozenHistory.transactions[0]!.topLevelInstructions[0]!.dataHex, "hex");
    data[1] ^= 1;
    value.frozenHistory.transactions[0]!.topLevelInstructions[0]!.dataHex = data.toString("hex");
    value.frozenHistory.inventoryRoot = frozenHistoryInventoryRootV3(value.frozenHistory.transactions);
  })), /freeze instruction expectation/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => {
    value.frozenHistory.transactions[2]!.topLevelInstructions[2]!.accounts[6]!.pubkey = key(88).toBase58();
    value.frozenHistory.inventoryRoot = frozenHistoryInventoryRootV3(value.frozenHistory.transactions);
  })), /account identity or privilege mismatch/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => {
    value.frozenHistory.transactions[2]!.topLevelInstructions[2]!.accounts[3]!.isWritable = false;
    value.frozenHistory.inventoryRoot = frozenHistoryInventoryRootV3(value.frozenHistory.transactions);
  })), /account identity or privilege mismatch/u);
});

test("failed hostile transactions remain inventory-bound without becoming a receipt denial of service", () => {
  const receipt = validReceipt();
  const withFailedAttempt = changed(receipt, (value) => {
    const failed = historyTransaction(95, 7, [historyInstruction(value.identities.targetProgram, "deadbeef", [meta(value.identities.targetProgram, false, true)])]);
    failed.status = "failed";
    failed.errorSha256 = h(200);
    value.frozenHistory.transactions = [value.frozenHistory.transactions[0]!, failed, ...value.frozenHistory.transactions.slice(1)];
    value.frozenHistory.inventoryRoot = frozenHistoryInventoryRootV3(value.frozenHistory.transactions);
  });
  assert.equal(verifyGovernedUpgradeReceiptV3(withFailedAttempt).valid, true);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(withFailedAttempt, (value) => {
    value.frozenHistory.transactions[1]!.errorSha256 = "0".repeat(64);
    value.frozenHistory.inventoryRoot = frozenHistoryInventoryRootV3(value.frozenHistory.transactions);
  })), /failed transaction must bind a nonzero error hash/u);
});

test("injected finalized reader rejects omission, addition, reordering, and cluster or interval drift", async () => {
  const receipt = validReceipt();
  const exactHistoryRead = {
    clusterDomainHex: receipt.frozenHistory.query.clusterDomainHex,
    startSlot: receipt.frozenHistory.query.startSlot,
    endSlot: receipt.frozenHistory.query.endSlot,
    transactions: receipt.frozenHistory.transactions,
  };
  const exactAccountRead = {
    context: receipt.finalizedAccounts.query.context,
    snapshots: receipt.finalizedAccounts.snapshots,
  };
  const exactRejectionRead = {
    clusterDomainHex: receipt.handoff.oldAuthorityRejection.query.clusterDomainHex,
    slot: receipt.handoff.oldAuthorityRejection.query.slot,
    programdataAuthority: receipt.handoff.oldAuthorityRejection.programdataAuthority,
    transaction: receipt.handoff.oldAuthorityRejection.transaction,
  };
  const exactReader = {
    readFinalizedFrozenHistory: async () => exactHistoryRead,
    readFinalizedAccountSnapshots: async () => exactAccountRead,
    readFinalizedOldAuthorityRejection: async () => exactRejectionRead,
  };
  const verified = await verifyGovernedUpgradeReceiptV3AgainstFinalizedHistory(receipt, {
    ...exactReader,
  });
  assert.equal(verified.finalizedSourceVerification, "finalized-source-requeried");
  await assert.rejects(verifyGovernedUpgradeReceiptV3AgainstFinalizedHistory(receipt, {
    readFinalizedFrozenHistory: async () => exactHistoryRead,
  } as never), /every injected read-only finalized history, account, and rejection API/u);
  await assert.rejects(verifyGovernedUpgradeReceiptV3AgainstFinalizedHistory(receipt, {
    ...exactReader,
    readFinalizedFrozenHistory: async () => ({ ...exactHistoryRead, transactions: exactHistoryRead.transactions.slice(1) }),
  }), /omission, addition, reordering, or content drift/u);
  await assert.rejects(verifyGovernedUpgradeReceiptV3AgainstFinalizedHistory(receipt, {
    ...exactReader,
    readFinalizedFrozenHistory: async () => ({ ...exactHistoryRead, transactions: [...exactHistoryRead.transactions, exactHistoryRead.transactions[0]!] }),
  }), /omission, addition, reordering, or content drift/u);
  await assert.rejects(verifyGovernedUpgradeReceiptV3AgainstFinalizedHistory(receipt, {
    ...exactReader,
    readFinalizedFrozenHistory: async () => ({ ...exactHistoryRead, transactions: [...exactHistoryRead.transactions].reverse() }),
  }), /omission, addition, reordering, or content drift/u);
  await assert.rejects(verifyGovernedUpgradeReceiptV3AgainstFinalizedHistory(receipt, {
    ...exactReader,
    readFinalizedFrozenHistory: async () => ({ ...exactHistoryRead, clusterDomainHex: h(99) }),
  }), /cluster or frozen-interval/u);
  await assert.rejects(verifyGovernedUpgradeReceiptV3AgainstFinalizedHistory(receipt, {
    ...exactReader,
    readFinalizedAccountSnapshots: async () => ({ ...exactAccountRead, snapshots: exactAccountRead.snapshots.slice(1) }),
  }), /account inventory has an omission, addition, reordering, or content drift/u);
  await assert.rejects(verifyGovernedUpgradeReceiptV3AgainstFinalizedHistory(receipt, {
    ...exactReader,
    readFinalizedAccountSnapshots: async () => ({ ...exactAccountRead, snapshots: [...exactAccountRead.snapshots].reverse() }),
  }), /account inventory has an omission, addition, reordering, or content drift/u);
  await assert.rejects(verifyGovernedUpgradeReceiptV3AgainstFinalizedHistory(receipt, {
    ...exactReader,
    readFinalizedAccountSnapshots: async () => ({
      ...exactAccountRead,
      snapshots: exactAccountRead.snapshots.map((snapshot, index) => index === 0 ? { ...snapshot, lamports: "1000001" } : snapshot),
    }),
  }), /account inventory has an omission, addition, reordering, or content drift/u);
  await assert.rejects(verifyGovernedUpgradeReceiptV3AgainstFinalizedHistory(receipt, {
    ...exactReader,
    readFinalizedAccountSnapshots: async () => ({ ...exactAccountRead, context: { ...exactAccountRead.context, blockHash: h(98) } }),
  }), /finalized block identity drifted/u);
  await assert.rejects(verifyGovernedUpgradeReceiptV3AgainstFinalizedHistory(receipt, {
    ...exactReader,
    readFinalizedOldAuthorityRejection: async () => ({ ...exactRejectionRead, programdataAuthority: key(49).toBase58() }),
  }), /authority graph drifted/u);
  await assert.rejects(verifyGovernedUpgradeReceiptV3AgainstFinalizedHistory(receipt, {
    ...exactReader,
    readFinalizedOldAuthorityRejection: async () => ({ ...exactRejectionRead, transaction: { ...exactRejectionRead.transaction, errorSha256: h(99) } }),
  }), /failed old-authority transaction has an omission/u);
});

test("controller trust evidence recomputes every blob, Program/ProgramData link, payload, raw bytes, and config identities", () => {
  const receipt = validReceipt();
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => { value.controllerTrustRoot.sourceTree.sha256 = h(99); })), /SHA-256 does not recompute/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => {
    value.controllerTrustRoot.sourceCommit = receiptContentAddressedBlobV3(Buffer.from("x", "utf8"));
  })), /canonical JSON/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => {
    const manifest = JSON.parse(Buffer.from(value.controllerTrustRoot.sourceCommit.bytesBase64, "base64").toString("utf8")) as Record<string, unknown>;
    manifest.commitId = "b".repeat(40);
    value.controllerTrustRoot.sourceCommit = manifestBlob(manifest);
  })), /ABI.*exact source commit|does not bind the exact source commit/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => {
    const manifest = JSON.parse(Buffer.from(value.controllerTrustRoot.buildInputInventory.bytesBase64, "base64").toString("utf8")) as Record<string, unknown>;
    manifest.controllerArtifactSha256 = h(98);
    value.controllerTrustRoot.buildInputInventory = manifestBlob(manifest);
  })), /buildInputInventory.*exact source|does not bind the exact source/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => {
    const manifest = JSON.parse(Buffer.from(value.controllerTrustRoot.immutabilityPlan.bytesBase64, "base64").toString("utf8")) as Record<string, unknown>;
    manifest.initializationStateSha256 = h(97);
    value.controllerTrustRoot.immutabilityPlan = manifestBlob(manifest);
  })), /immutabilityPlan.*cross-bind|does not cross-bind/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => {
    const raw = Buffer.from(value.controllerTrustRoot.controllerProgramdata.rawProgramdata.bytesBase64, "base64");
    raw[45] ^= 1;
    value.controllerTrustRoot.controllerProgramdata.rawProgramdata.bytesBase64 = raw.toString("base64");
  })), /finalizedAccounts.controller-programdata|SHA-256 does not recompute/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => {
    const raw = Buffer.from(value.controllerTrustRoot.controllerProgramdata.rawProgramdata.bytesBase64, "base64");
    raw[45] ^= 1;
    value.controllerTrustRoot.controllerProgramdata.rawProgramdata = receiptContentAddressedBlobV3(raw);
  })), /finalizedAccounts.controller-programdata|cross-bind|payload or zero tail/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => {
    const program = Buffer.from(value.controllerTrustRoot.controllerProgramAccount.bytesBase64, "base64");
    key(98).toBuffer().copy(program, 4);
    value.controllerTrustRoot.controllerProgramAccount = receiptContentAddressedBlobV3(program);
  })), /finalizedAccounts.controller-program|cross-bind|linkage is not canonical/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => { value.controllerTrustRoot.controllerImmutable = true; })), /cross-bind|mechanical ProgramData authority/u);
});

test("handoff and production trust claims remain fail closed", () => {
  const receipt = validReceipt();
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => { value.production = true; })), /predeployment-r4 schema cannot assert/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => {
    (value.handoff as unknown as Record<string, unknown>).oldAuthorityDirectUpgradeRejected = true;
  })), /unknown schema fields/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => {
    (value.handoff as unknown as Record<string, unknown>).performed = "false";
  })), /mode flags must be booleans/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => {
    value.handoff.oldAuthorityRejection.transaction.status = "succeeded";
    value.handoff.oldAuthorityRejection.transaction.errorSha256 = "0".repeat(64);
  })), /must be a source-identifiable failed transaction/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => {
    value.handoff.oldAuthorityRejection.transaction.topLevelInstructions[0]!.accounts[6]!.pubkey = value.identities.authorityPda;
  })), /account identity or privilege mismatch/u);
  assert.throws(() => verifyGovernedUpgradeReceiptV3(changed(receipt, (value) => {
    value.handoff.oldAuthorityRejection.deterministicIdentity = h(99);
  })), /does not recompute/u);
});
