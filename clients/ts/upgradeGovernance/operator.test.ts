import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AddressLookupTableAccount,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  BufferVerificationStatusV1,
  GateStatusV1,
  ProgramDataVerificationStatusV1,
  ProposalStateV2,
  StateCheckpointPhaseV1,
} from "./release1.js";
import { encodeApproveProposalV3 } from "./release1V3Instructions.js";
import { encodeExecuteUpgradeV2 } from "./release1V3CustodyInstructions.js";
import {
  COMPUTE_BUDGET_PROGRAM_ID_V1,
  ExclusiveOperatorLockV1,
  GovernanceJournalV1,
  OPERATOR_EXPECTED_TAGS_V1,
  OPERATOR_MUTATION_COMMANDS_V1,
  OperatorBackoffExitV1,
  RECENT_BLOCKHASHES_SYSVAR_ID_V1,
  RpcRateLimit429V1,
  SYSTEM_PROGRAM_ID_V1,
  executeGovernanceMutationV1,
  validateAssembledGovernanceTransactionV1,
  validateCompiledGovernanceMessageV1,
  validatePreparedGovernanceTransactionV1,
  validateBoundedEmergencyResolutionEnvelopeV1,
  type ExecuteGovernanceMutationV1Input,
  type FinalizedGovernanceReadAdapterV1,
  type PreparedGovernanceTransactionV1,
} from "./operator.js";
import {
  Release1PlanKindV1,
  planRelease1ProposalOperationV1,
  type Release1ProposalPlanBindingsV1,
} from "./release1Planning.js";

const bytes = (value: number): Buffer => Buffer.alloc(32, value);
const key = (value: number): PublicKey => new PublicKey(bytes(value));
const genesisHash = key(1).toBase58();

function approveAccounts() {
  return [
    { pubkey: key(3), isSigner: false, isWritable: false },
    { pubkey: key(21), isSigner: false, isWritable: false },
    { pubkey: key(18), isSigner: false, isWritable: false },
    { pubkey: key(7), isSigner: false, isWritable: false },
    { pubkey: key(30), isSigner: false, isWritable: false },
    { pubkey: key(31), isSigner: false, isWritable: false },
    { pubkey: key(9), isSigner: false, isWritable: true },
    { pubkey: key(32), isSigner: false, isWritable: false },
    { pubkey: key(20), isSigner: true, isWritable: false },
  ] as const;
}

test("operator exposes every typed emergency and rollback mutation route", () => {
  assert.deepEqual(OPERATOR_EXPECTED_TAGS_V1["observe-programdata"], [39, 40, 41, 42]);
  assert.deepEqual(OPERATOR_EXPECTED_TAGS_V1["record-controller-immutability"], [43]);
  assert.deepEqual(OPERATOR_EXPECTED_TAGS_V1["create-emergency-resolution"], [62]);
  assert.deepEqual(OPERATOR_EXPECTED_TAGS_V1["approve-emergency-resolution"], [63]);
  assert.deepEqual(OPERATOR_EXPECTED_TAGS_V1["queue-emergency-resolution"], [64]);
  assert.deepEqual(OPERATOR_EXPECTED_TAGS_V1["execute-emergency-resolution"], [65]);
  assert.deepEqual(OPERATOR_EXPECTED_TAGS_V1["activate-rollback"], [81]);
  assert.deepEqual(OPERATOR_EXPECTED_TAGS_V1["observe-programdata-failure"], [72]);
  const governanceLivenessV2Routes = [
    ["initialize-governance-lifecycle-registry-v2", 82],
    ["create-governance-timing-profile-v1", 83],
    ["create-timing-policy-change-v1", 84],
    ["approve-timing-policy-change-v1", 85],
    ["cancel-timing-policy-change-v1", 86],
    ["expire-timing-policy-change-v1", 87],
    ["queue-timing-policy-change-v1", 88],
    ["execute-timing-policy-change-v1", 89],
    ["create-council-rotation-v2", 90],
    ["approve-council-rotation-v2", 91],
    ["cancel-council-rotation-v2", 92],
    ["expire-council-rotation-v2", 93],
    ["queue-council-rotation-v2", 94],
    ["execute-council-rotation-v2", 95],
    ["create-target-authority-handoff-v2", 96],
    ["approve-target-authority-handoff-v2", 97],
    ["cancel-target-authority-handoff-v2", 98],
    ["expire-target-authority-handoff-v2", 99],
    ["queue-target-authority-handoff-v2", 100],
    ["execute-target-authority-handoff-v2", 101],
    ["create-bootstrap-activation-v2", 102],
    ["approve-bootstrap-activation-v2", 103],
    ["cancel-bootstrap-activation-v2", 104],
    ["expire-bootstrap-activation-v2", 105],
    ["queue-bootstrap-activation-v2", 106],
    ["execute-bootstrap-activation-v2", 107],
  ] as const;
  for (const [command, tag] of governanceLivenessV2Routes) {
    assert.deepEqual(OPERATOR_EXPECTED_TAGS_V1[command], [tag]);
  }
  assert.equal(new Set(OPERATOR_MUTATION_COMMANDS_V1).size, OPERATOR_MUTATION_COMMANDS_V1.length);
  assert.deepEqual(
    Object.keys(OPERATOR_EXPECTED_TAGS_V1).sort(),
    [...OPERATOR_MUTATION_COMMANDS_V1].sort(),
  );
});

test("emergency resolution operator envelope is canonical, bounded, and nonce-free", () => {
  const limit = Buffer.alloc(5); limit[0] = 2; limit.writeUInt32LE(1_200_000, 1);
  const price = Buffer.alloc(9); price[0] = 3; price.writeBigUInt64LE(17n, 1);
  const controller = { kind: "controller" as const, programId: key(2), data: Buffer.from([65]), accounts: [] };
  const envelope = [
    { kind: "compute-unit-limit" as const, programId: COMPUTE_BUDGET_PROGRAM_ID_V1, data: limit, accounts: [] },
    { kind: "compute-unit-price" as const, programId: COMPUTE_BUDGET_PROGRAM_ID_V1, data: price, accounts: [] },
    controller,
  ];
  assert.doesNotThrow(() => validateBoundedEmergencyResolutionEnvelopeV1(envelope));
  const tooLarge = Buffer.from(limit); tooLarge.writeUInt32LE(1_400_001, 1);
  assert.throws(() => validateBoundedEmergencyResolutionEnvelopeV1([
    { ...envelope[0]!, data: tooLarge }, envelope[1]!, controller,
  ]), /outside/u);
  assert.throws(() => validateBoundedEmergencyResolutionEnvelopeV1([
    { kind: "durable-nonce-advance", programId: SYSTEM_PROGRAM_ID_V1, data: Buffer.from([4, 0, 0, 0]), accounts: [] },
    ...envelope,
  ]));
  assert.throws(() => validateBoundedEmergencyResolutionEnvelopeV1([
    envelope[1]!, envelope[0]!, controller,
  ]));
});

function bindings(): Release1ProposalPlanBindingsV1 {
  return {
    kind: Release1PlanKindV1.ApproveProposal,
    clusterDomain: key(1).toBuffer(),
    controllerProgram: key(2),
    controllerConfig: key(3),
    controllerInstructionData: approvalData,
    controllerInstructionAccounts: approveAccounts(),
    controllerLookupTable: null,
    targetProgram: key(4),
    targetProgramdata: key(5),
    authorityPda: key(6),
    programdataAuthority: key(6),
    protocolGate: key(7),
    gateStatus: GateStatusV1.Active,
    gateEpoch: 8n,
    proposal: key(9),
    proposalDigest: bytes(10),
    proposalState: ProposalStateV2.BufferVerified,
    reviewStartSlot: 20n,
    reviewEndSlot: 30n,
    notBeforeSlot: 40n,
    expirySlot: 50n,
    councilVersion: 11n,
    councilHash: bytes(12),
    council: key(18),
    targetNonce: 13n,
    programdataDeployedSlot: 21n,
    programdataCapacity: 1_000n,
    buffer: key(14),
    bufferAuthority: key(19),
    bufferVerificationStatus: BufferVerificationStatusV1.Verified,
    bufferVerifiedChunkCount: 1,
    bufferChunkCount: 1,
    artifactSha256: bytes(15),
    artifactChunkMerkleRoot: bytes(16),
    programdataVerificationStatus: ProgramDataVerificationStatusV1.Verifying,
    programdataVerifiedPayloadChunkCount: 0,
    programdataVerifiedZeroTailChunkCount: 0,
    checkpoint: key(20),
    checkpointDigest: bytes(17),
    checkpointPhase: StateCheckpointPhaseV1.Prestate,
    checkpointAccepted: false,
  };
}

const approvalData = encodeApproveProposalV3({
  expected: {
    expectedProposalDigest: bytes(10),
    expectedState: ProposalStateV2.BufferVerified,
    expectedGateStatus: GateStatusV1.Active,
    expectedGateEpoch: 8n,
    expectedTargetNonce: 13n,
    expectedCapacityPolicyDigest: bytes(30),
    expectedCurrentDeploymentDigest: bytes(31),
    expectedCurrentDeploymentGeneration: 1n,
  },
  expectedCreationCouncilVersion: 11n,
  expectedCreationCouncilHash: bytes(12),
  expectedApprovalBitset: 0,
  expectedApprovalCount: 0,
});

function prepared(): PreparedGovernanceTransactionV1 {
  return {
    controllerProgram: key(2),
    controllerInstructionData: approvalData,
    feePayer: key(22),
    recentBlockhash: key(60).toBase58(),
    messageVersion: "legacy",
    addressLookupTableAccounts: [],
    topLevelInstructions: [{
      kind: "controller",
      programId: key(2),
      data: approvalData,
      accounts: approveAccounts(),
    }],
  };
}

function compilePreparedMessage(transaction: PreparedGovernanceTransactionV1): Buffer {
  const instructions = transaction.topLevelInstructions.map((instruction) => new TransactionInstruction({
    programId: instruction.programId,
    data: instruction.data,
    keys: instruction.accounts.map((account) => ({ ...account })),
  }));
  const message = new TransactionMessage({
    payerKey: transaction.feePayer,
    recentBlockhash: transaction.recentBlockhash,
    instructions,
  });
  return Buffer.from(
    transaction.messageVersion === 0
      ? message.compileToV0Message([...transaction.addressLookupTableAccounts]).serialize()
      : message.compileToLegacyMessage().serialize(),
  );
}

function assemblePreparedMessage(
  transaction: PreparedGovernanceTransactionV1,
  message: Buffer,
  signatures: readonly { authority: PublicKey; signature: Buffer }[],
): Buffer {
  const signed = new VersionedTransaction(VersionedMessage.deserialize(message));
  for (const entry of signatures) signed.addSignature(entry.authority, entry.signature);
  return Buffer.from(signed.serialize());
}

function withTempDirectory(run: (directory: string) => Promise<void> | void): Promise<void> | void {
  const directory = mkdtempSync(join(tmpdir(), "ameba-governance-operator-test-"));
  const result = run(directory);
  if (result instanceof Promise) return result.finally(() => rmSync(directory, { recursive: true, force: true }));
  rmSync(directory, { recursive: true, force: true });
}

function executorInput(
  directory: string,
  overrides: Partial<ExecuteGovernanceMutationV1Input> = {},
): ExecuteGovernanceMutationV1Input {
  const plan = planRelease1ProposalOperationV1(bindings());
  const readAdapter: FinalizedGovernanceReadAdapterV1 = {
    async getGenesisHash() { return genesisHash; },
    async rereadPlanBindings() { return { commitment: "finalized", contextSlot: 100n, bindings: bindings() }; },
    async observeAccounts() { return []; },
  };
  return {
    command: "approve",
    plan,
    armOperationId: plan.operationId,
    expectedGenesisHash: genesisHash,
    production: false,
    readAdapter,
    transactionAdapter: {
      async prepare() { return prepared(); },
      async compileMessage(transaction) { return compilePreparedMessage(transaction); },
      async assembleSignedTransaction(transaction, message, signatures) { return assemblePreparedMessage(transaction, message, signatures); },
    },
    signers: [
      { providerKind: "kms", authority: key(22), async signMessage() { return Buffer.alloc(64, 22); } },
      { providerKind: "kms", authority: key(20), async signMessage() { return Buffer.alloc(64, 20); } },
    ],
    submission: { async submitSignedTransaction() { return { signature: "mock-finalized-signature" }; } },
    async confirmDecodedAction() { return true; },
    journal: new GovernanceJournalV1(join(directory, "operator.jsonl")),
    lock: new ExclusiveOperatorLockV1(join(directory, "operator.lock")),
    ...overrides,
  };
}

test("journal is durable, hash-chained, recoverable, and recursively redacted", () => withTempDirectory((directory) => {
  const path = join(directory, "operator.jsonl");
  const journal = new GovernanceJournalV1(path);
  const operationId = "ab".repeat(32);
  journal.append(operationId, "plan", {
    privateKey: "do-not-write",
    private_key: "also-do-not-write",
    nested: { authorization: "Bearer token", seed_phrase: "twelve words", walletKeypair: [1, 2, 3], safe: "visible" },
  });
  journal.append(operationId, "confirmed", { ok: true });
  const raw = readFileSync(path, "utf8");
  assert.equal(raw.includes("do-not-write"), false);
  assert.equal(raw.includes("Bearer token"), false);
  assert.equal(raw.includes("also-do-not-write"), false);
  assert.equal(raw.includes("twelve words"), false);
  assert.equal(raw.includes("[REDACTED]"), true);
  assert.equal(journal.recover().length, 2);
  writeFileSync(path, raw.replace("confirmed", "tampered"), "utf8");
  assert.throws(() => journal.recover(), /hash chain failed/u);
}));

test("exclusive lock rejects a second operator and releases only its exact lock", () => withTempDirectory((directory) => {
  const path = join(directory, "operator.lock");
  const first = new ExclusiveOperatorLockV1(path);
  const second = new ExclusiveOperatorLockV1(path);
  first.acquire("11".repeat(32));
  assert.equal(existsSync(path), true);
  assert.throws(() => second.acquire("22".repeat(32)));
  first.release();
  assert.equal(existsSync(path), false);
  second.acquire("22".repeat(32));
  second.release();
}));

test("typed non-envelope actions reject every sibling or raw instruction", () => {
  const plan = planRelease1ProposalOperationV1(bindings());
  const transaction = prepared();
  transaction.topLevelInstructions = [
    { kind: "compute-unit-limit", programId: key(30), data: Buffer.from([2, 1, 0, 0, 0]), accounts: [] },
    ...transaction.topLevelInstructions,
  ];
  assert.throws(() => validatePreparedGovernanceTransactionV1("approve", plan, transaction), /admits only/u);
  const raw = prepared() as unknown as { topLevelInstructions: unknown[] };
  raw.topLevelInstructions = [{ kind: "arbitrary", programId: key(31), data: Buffer.alloc(0), accounts: [] }, ...prepared().topLevelInstructions];
  assert.throws(() => validatePreparedGovernanceTransactionV1("approve", plan, raw as unknown as PreparedGovernanceTransactionV1));
});

test("armed plans bind exact controller bytes, ordered accounts, privileges, and derived display", () => {
  const plan = planRelease1ProposalOperationV1(bindings());
  const action = validatePreparedGovernanceTransactionV1("approve", plan, prepared());
  assert.equal(action.instructionName, "ApproveProposalV3");
  assert.equal(action.instructionTag, 55);
  assert.equal(action.instructionDataHex, approvalData.toString("hex"));
  assert.deepEqual(
    (action.accounts as readonly { pubkey: string }[]).map((account) => account.pubkey),
    approveAccounts().map((account) => account.pubkey.toBase58()),
  );

  const changedData = Buffer.from(approvalData);
  changedData[1] ^= 1;
  const dataSwap = prepared();
  dataSwap.controllerInstructionData = changedData;
  dataSwap.topLevelInstructions = [{
    ...dataSwap.topLevelInstructions[0]!,
    data: changedData,
  }];
  assert.throws(
    () => validatePreparedGovernanceTransactionV1("approve", plan, dataSwap),
    /does not match the armed plan/u,
  );

  const accountSwap = prepared();
  accountSwap.topLevelInstructions = [{
    ...accountSwap.topLevelInstructions[0]!,
    accounts: accountSwap.topLevelInstructions[0]!.accounts.map((account, index) => (
      index === 6 ? { ...account, pubkey: key(99) } : account
    )),
  }];
  assert.throws(
    () => validatePreparedGovernanceTransactionV1("approve", plan, accountSwap),
    /controller\[6\] account metadata drifted/u,
  );

  const privilegeSwap = prepared();
  privilegeSwap.topLevelInstructions = [{
    ...privilegeSwap.topLevelInstructions[0]!,
    accounts: privilegeSwap.topLevelInstructions[0]!.accounts.map((account, index) => (
      index === 6 ? { ...account, isWritable: false } : account
    )),
  }];
  assert.throws(
    () => validatePreparedGovernanceTransactionV1("approve", plan, privilegeSwap),
    /controller\[6\] account metadata drifted/u,
  );
});

test("signer and submission bytes are mechanically bound to the validated action", () => {
  const transaction = prepared();
  const message = compilePreparedMessage(transaction);
  const validated = validateCompiledGovernanceMessageV1(transaction, message);
  assert.equal(validated.version, "legacy");
  assert.equal(validated.feePayer.toBase58(), key(22).toBase58());

  const alternatePayer = { ...transaction, feePayer: key(99) };
  assert.throws(
    () => validateCompiledGovernanceMessageV1(transaction, compilePreparedMessage(alternatePayer)),
    /fee payer drifted/u,
  );

  const alternateAccount = prepared();
  alternateAccount.topLevelInstructions = [{
    ...alternateAccount.topLevelInstructions[0]!,
    accounts: alternateAccount.topLevelInstructions[0]!.accounts.map((account, index) => (
      index === 4 ? { ...account, pubkey: key(99) } : account
    )),
  }];
  assert.throws(
    () => validateCompiledGovernanceMessageV1(transaction, compilePreparedMessage(alternateAccount)),
    /compiled\[0\]\[4\] account metadata drifted/u,
  );

  const signatureEntries = [
    { authority: key(22), signature: Buffer.alloc(64, 22) },
    { authority: key(20), signature: Buffer.alloc(64, 20) },
  ];
  const signed = assemblePreparedMessage(transaction, message, signatureEntries);
  assert.doesNotThrow(() => validateAssembledGovernanceTransactionV1(
    signed,
    validated,
    signatureEntries,
  ));
  assert.throws(() => validateAssembledGovernanceTransactionV1(
    signed,
    validated,
    [signatureEntries[0]!, { authority: key(20), signature: Buffer.alloc(64, 99) }],
  ), /substituted an injected signature/u);

  const differentBlockhash = { ...transaction, recentBlockhash: key(61).toBase58() };
  const differentMessage = compilePreparedMessage(differentBlockhash);
  const differentSigned = assemblePreparedMessage(differentBlockhash, differentMessage, signatureEntries);
  assert.throws(() => validateAssembledGovernanceTransactionV1(
    differentSigned,
    validated,
    signatureEntries,
  ), /substituted the validated message/u);
  assert.throws(() => validateAssembledGovernanceTransactionV1(
    Buffer.alloc(1_233),
    validated,
    signatureEntries,
  ), /1,232-byte/u);
});

test("v0 execution binds one finalized warm lookup snapshot into the armed plan", () => {
  const table = new AddressLookupTableAccount({
    key: key(70),
    state: {
      deactivationSlot: 0xffff_ffff_ffff_ffffn,
      lastExtendedSlot: 10,
      lastExtendedSlotStartIndex: 0,
      authority: key(71),
      addresses: [key(3), key(21), key(18), key(7), key(9)],
    },
  });
  const lookupBinding = {
    lookupTable: table.key,
    lookupTableAuthority: table.state.authority ?? null,
    lookupTableDeactivationSlot: table.state.deactivationSlot,
    lookupTableLastExtendedSlot: BigInt(table.state.lastExtendedSlot),
    lookupTableLastExtendedSlotStartIndex: table.state.lastExtendedSlotStartIndex,
    lookupTableAddresses: table.state.addresses,
    requiredLookupAddresses: table.state.addresses,
    observedSlot: 20n,
    validThroughSlot: 100n,
  } as const;
  const plan = planRelease1ProposalOperationV1({
    ...bindings(),
    controllerLookupTable: lookupBinding,
  });
  const transaction = prepared();
  transaction.messageVersion = 0;
  transaction.addressLookupTableAccounts = [table];
  assert.doesNotThrow(() => validatePreparedGovernanceTransactionV1("approve", plan, transaction));
  assert.doesNotThrow(() => validateCompiledGovernanceMessageV1(
    transaction,
    compilePreparedMessage(transaction),
  ));

  const staleTable = new AddressLookupTableAccount({
    key: table.key,
    state: { ...table.state, addresses: [...table.state.addresses.slice(0, -1), key(99)] },
  });
  const stalePrepared = { ...transaction, addressLookupTableAccounts: [staleTable] };
  assert.throws(
    () => validatePreparedGovernanceTransactionV1("approve", plan, stalePrepared),
    /lookup table no longer matches/u,
  );
  assert.notEqual(
    planRelease1ProposalOperationV1({
      ...bindings(),
      controllerLookupTable: { ...lookupBinding, lookupTableAddresses: staleTable.state.addresses },
    }).operationId,
    plan.operationId,
  );
});

test("armed v0 execution rereads the exact finalized lookup table before signing and submission", () => withTempDirectory(async (directory) => {
  const table = new AddressLookupTableAccount({
    key: key(70),
    state: {
      deactivationSlot: 0xffff_ffff_ffff_ffffn,
      lastExtendedSlot: 10,
      lastExtendedSlotStartIndex: 0,
      authority: key(71),
      addresses: [key(3), key(21), key(18), key(7), key(9)],
    },
  });
  const lookupBinding = {
    lookupTable: table.key,
    lookupTableAuthority: table.state.authority ?? null,
    lookupTableDeactivationSlot: table.state.deactivationSlot,
    lookupTableLastExtendedSlot: BigInt(table.state.lastExtendedSlot),
    lookupTableLastExtendedSlotStartIndex: table.state.lastExtendedSlotStartIndex,
    lookupTableAddresses: table.state.addresses,
    requiredLookupAddresses: table.state.addresses,
    observedSlot: 20n,
    validThroughSlot: 100n,
  } as const;
  const bound = { ...bindings(), controllerLookupTable: lookupBinding };
  const plan = planRelease1ProposalOperationV1(bound);
  const transaction = prepared();
  transaction.messageVersion = 0;
  transaction.addressLookupTableAccounts = [table];
  let planRereads = 0;
  let lookupRereads = 0;
  let signerCalls = 0;
  let submissions = 0;
  const input = executorInput(directory, {
    plan,
    armOperationId: plan.operationId,
    readAdapter: {
      async getGenesisHash() { return genesisHash; },
      async rereadPlanBindings() {
        planRereads += 1;
        return { commitment: "finalized", contextSlot: BigInt(100 + planRereads), bindings: bound };
      },
      async observeAccounts() { return []; },
      async rereadAddressLookupTable() {
        lookupRereads += 1;
        return {
          commitment: "finalized",
          contextSlot: BigInt(20 + lookupRereads),
          lookupTableAccount: table,
        };
      },
    },
    transactionAdapter: {
      async prepare() { return transaction; },
      async compileMessage(value) { return compilePreparedMessage(value); },
      async assembleSignedTransaction(value, message, signatures) {
        return assemblePreparedMessage(value, message, signatures);
      },
    },
    signers: [
      { providerKind: "kms", authority: key(22), async signMessage() { signerCalls += 1; return Buffer.alloc(64, 22); } },
      { providerKind: "hardware", authority: key(20), async signMessage() { signerCalls += 1; return Buffer.alloc(64, 20); } },
    ],
    submission: {
      async submitSignedTransaction() {
        submissions += 1;
        return { signature: "mock-v0-signature" };
      },
    },
  });

  assert.deepEqual(await executeGovernanceMutationV1(input), { signature: "mock-v0-signature" });
  assert.equal(planRereads, 3);
  assert.equal(lookupRereads, 2);
  assert.equal(signerCalls, 2);
  assert.equal(submissions, 1);
}));

test("every payer and authority signature is explicit and byte-verified", () => {
  const transaction = prepared();
  transaction.feePayer = key(22);
  const message = compilePreparedMessage(transaction);
  const validated = validateCompiledGovernanceMessageV1(transaction, message);
  assert.deepEqual(
    validated.requiredSignerAuthorities.map((authority) => authority.toBase58()),
    [key(22).toBase58(), key(20).toBase58()],
  );
  const signatures = [
    { authority: key(22), signature: Buffer.alloc(64, 22) },
    { authority: key(20), signature: Buffer.alloc(64, 20) },
  ];
  const signed = assemblePreparedMessage(transaction, message, signatures);
  assert.doesNotThrow(() => validateAssembledGovernanceTransactionV1(
    signed,
    validated,
    signatures,
  ));
  assert.throws(() => validateAssembledGovernanceTransactionV1(
    signed,
    validated,
    signatures.slice(0, 1),
  ), /lacks an explicit required signature/u);
  assert.throws(() => validateAssembledGovernanceTransactionV1(
    signed,
    validated,
    [...signatures, { authority: key(99), signature: Buffer.alloc(64, 99) }],
  ), /lacks an explicit required signature/u);
});

test("typed loader action accepts only its exact nonce/compute/controller envelope", () => {
  const base = bindings();
  const nonce = key(40);
  const nonceAuthority = key(41);
  const data = encodeExecuteUpgradeV2({
    expected: {
      expectedProposalDigest: bytes(10), expectedState: ProposalStateV2.Frozen,
      expectedGateStatus: GateStatusV1.FrozenForUpgrade, expectedGateEpoch: 8n, expectedTargetNonce: 13n,
      expectedCapacityPolicyDigest: bytes(42), expectedCurrentDeploymentDigest: bytes(43), expectedCurrentDeploymentGeneration: 1n,
    },
    expectedPrestateCheckpointDigest: bytes(17), expectedPrestateCheckpointGeneration: 1n,
    expectedObservationDigest: bytes(46), expectedObservationGeneration: 1n, expectedObservationRoot: bytes(47),
    expectedObservationFinalizedSlot: 48n, expectedActualCapacity: 49n, expectedSealedBufferHeaderHash: bytes(44),
    expectedVerifiedChunkCount: 1, expectedCounterpartProposalDigest: bytes(45),
    expectedBufferVerificationStatus: BufferVerificationStatusV1.Verified,
    expectedCounterpartBufferVerificationStatus: BufferVerificationStatusV1.Verified,
    envelope: {
      computeUnitLimit: 1_200_000,
      computeUnitPriceMicroLamports: 17n,
      durableNonceAccount: { present: true, value: nonce },
      durableNonceAuthority: { present: true, value: nonceAuthority },
    },
  });
  const limit = Buffer.alloc(5); limit[0] = 2; limit.writeUInt32LE(1_200_000, 1);
  const price = Buffer.alloc(9); price[0] = 3; price.writeBigUInt64LE(17n, 1);
  const transaction: PreparedGovernanceTransactionV1 = {
    controllerProgram: key(2),
    controllerInstructionData: data,
    feePayer: nonceAuthority,
    recentBlockhash: key(61).toBase58(),
    messageVersion: "legacy",
    addressLookupTableAccounts: [],
    topLevelInstructions: [
      { kind: "durable-nonce-advance", programId: SYSTEM_PROGRAM_ID_V1, data: Buffer.from([4, 0, 0, 0]), accounts: [
        { pubkey: nonce, isSigner: false, isWritable: true },
        { pubkey: RECENT_BLOCKHASHES_SYSVAR_ID_V1, isSigner: false, isWritable: false },
        { pubkey: nonceAuthority, isSigner: true, isWritable: false },
      ] },
      { kind: "compute-unit-limit", programId: COMPUTE_BUDGET_PROGRAM_ID_V1, data: limit, accounts: [] },
      { kind: "compute-unit-price", programId: COMPUTE_BUDGET_PROGRAM_ID_V1, data: price, accounts: [] },
      { kind: "controller", programId: key(2), data, accounts: [] },
    ],
  };
  const plan = planRelease1ProposalOperationV1({
    ...base,
    kind: Release1PlanKindV1.Upgrade,
    controllerInstructionData: data,
    controllerInstructionAccounts: [],
  });
  assert.doesNotThrow(() => validatePreparedGovernanceTransactionV1("execute-upgrade", plan, transaction));
  const wrongOrder = { ...transaction, topLevelInstructions: [transaction.topLevelInstructions[0]!, transaction.topLevelInstructions[2]!, transaction.topLevelInstructions[1]!, transaction.topLevelInstructions[3]!] };
  assert.throws(() => validatePreparedGovernanceTransactionV1("execute-upgrade", plan, wrongOrder), /compute-unit limit/u);
  const wrongNonce = { ...transaction, topLevelInstructions: transaction.topLevelInstructions.map((instruction, index) => index === 0 ? { ...instruction, data: Buffer.from([5, 0, 0, 0]) } : instruction) };
  assert.throws(() => validatePreparedGovernanceTransactionV1("execute-upgrade", plan, wrongNonce), /nonce advance/u);
});

test("stale reread before signing fails closed without signer or submission", () => withTempDirectory(async (directory) => {
  let signed = 0;
  let submitted = 0;
  const stale = { ...bindings(), gateEpoch: 99n };
  const input = executorInput(directory, {
    readAdapter: {
      async getGenesisHash() { return genesisHash; },
      async rereadPlanBindings() { return { commitment: "finalized", contextSlot: 100n, bindings: stale }; },
      async observeAccounts() { return []; },
    },
    signers: [{ providerKind: "hardware", authority: key(20), async signMessage() { signed += 1; return Buffer.alloc(64); } }],
    submission: { async submitSignedTransaction() { submitted += 1; return { signature: "forbidden" }; } },
  });
  await assert.rejects(executeGovernanceMutationV1(input), /stale or mutated/u);
  assert.equal(signed, 0);
  assert.equal(submitted, 0);
  assert.equal(existsSync(join(directory, "operator.lock")), false);
}));

test("every state-only finalized reread drift fails before signing", () => withTempDirectory(async (directory) => {
  const base = bindings();
  const drifts: Release1ProposalPlanBindingsV1[] = [
    { ...base, gateStatus: GateStatusV1.FrozenForUpgrade },
    { ...base, proposalState: ProposalStateV2.Frozen },
    { ...base, reviewStartSlot: base.reviewStartSlot + 1n },
    { ...base, reviewEndSlot: base.reviewEndSlot + 1n },
    { ...base, notBeforeSlot: base.notBeforeSlot + 1n },
    { ...base, expirySlot: base.expirySlot + 1n },
    { ...base, programdataDeployedSlot: base.programdataDeployedSlot + 1n },
    { ...base, programdataCapacity: base.programdataCapacity + 1n },
    { ...base, programdataAuthority: key(98) },
    { ...base, bufferVerificationStatus: BufferVerificationStatusV1.Verifying },
    { ...base, bufferVerifiedChunkCount: 0 },
    { ...base, bufferChunkCount: 2 },
    { ...base, bufferAuthority: key(98) },
    { ...base, programdataVerificationStatus: ProgramDataVerificationStatusV1.Verified },
    { ...base, programdataVerifiedPayloadChunkCount: 1 },
    { ...base, programdataVerifiedZeroTailChunkCount: 1 },
    { ...base, checkpointPhase: StateCheckpointPhaseV1.Poststate },
    { ...base, checkpointAccepted: true },
    { ...base, council: key(98) },
    { ...base, councilVersion: base.councilVersion + 1n },
    { ...base, councilHash: bytes(98) },
  ];
  for (const [index, stale] of drifts.entries()) {
    const child = join(directory, `drift-${index}`);
    mkdirSync(child);
    const input = executorInput(child, {
      readAdapter: {
        async getGenesisHash() { return genesisHash; },
        async rereadPlanBindings() { return { commitment: "finalized", contextSlot: 100n, bindings: stale }; },
        async observeAccounts() { return []; },
      },
    });
    await assert.rejects(executeGovernanceMutationV1(input), /stale or mutated/u);
  }
}));

test("mandatory immediate reread catches a freeze race before signing", () => withTempDirectory(async (directory) => {
  let rereads = 0;
  let signed = 0;
  let submitted = 0;
  const input = executorInput(directory);
  input.readAdapter = {
    async getGenesisHash() { return genesisHash; },
    async rereadPlanBindings() { rereads += 1; return { commitment: "finalized", contextSlot: BigInt(99 + rereads), bindings: rereads === 1 ? bindings() : { ...bindings(), targetNonce: 500n } }; },
    async observeAccounts() { return []; },
  };
  input.signers = [
    { providerKind: "wallet", authority: key(22), async signMessage() { signed += 1; return Buffer.alloc(64); } },
    { providerKind: "wallet", authority: key(20), async signMessage() { signed += 1; return Buffer.alloc(64); } },
  ];
  input.submission = { async submitSignedTransaction() { submitted += 1; return { signature: "forbidden" }; } };
  await assert.rejects(executeGovernanceMutationV1(input), /stale or mutated/u);
  assert.equal(rereads, 2);
  assert.equal(signed, 0);
  assert.equal(submitted, 0);
}));

test("weak or regressing reread commitment fails closed", () => withTempDirectory(async (directory) => {
  const weak = executorInput(directory);
  weak.readAdapter = {
    async getGenesisHash() { return genesisHash; },
    async rereadPlanBindings() { return { commitment: "confirmed" as never, contextSlot: 100n, bindings: bindings() }; },
    async observeAccounts() { return []; },
  };
  await assert.rejects(executeGovernanceMutationV1(weak), /not finalized/u);

  const secondDirectory = mkdtempSync(join(tmpdir(), "ameba-governance-regressing-read-test-"));
  try {
    let rereads = 0;
    let submissions = 0;
    const regressing = executorInput(secondDirectory);
    regressing.readAdapter = {
      async getGenesisHash() { return genesisHash; },
      async rereadPlanBindings() { rereads += 1; return { commitment: "finalized", contextSlot: rereads === 1 ? 100n : 99n, bindings: bindings() }; },
      async observeAccounts() { return []; },
    };
    regressing.submission = { async submitSignedTransaction() { submissions += 1; return { signature: "forbidden" }; } };
    await assert.rejects(executeGovernanceMutationV1(regressing), /monotonic finalized/u);
    assert.equal(submissions, 0);
  } finally {
    rmSync(secondDirectory, { recursive: true, force: true });
  }
}));

test("first 429 is persisted and exits without automatic retry", () => withTempDirectory(async (directory) => {
  let submissions = 0;
  const input = executorInput(directory, {
    submission: {
      async submitSignedTransaction() {
        submissions += 1;
        throw new RpcRateLimit429V1(12_345);
      },
    },
  });
  await assert.rejects(executeGovernanceMutationV1(input), (error) => error instanceof OperatorBackoffExitV1 && error.retryAfterMs === 12_345);
  assert.equal(submissions, 1);
  const events = input.journal.recover().map((entry) => entry.event);
  assert.equal(events.filter((event) => event === "rate-limit-exit").length, 1);
  assert.equal(events.includes("submitted"), false);
}));

test("decoded action confirmation is mandatory and successful mock path rereads three times", () => withTempDirectory(async (directory) => {
  let rereads = 0;
  let submissions = 0;
  const rejected = executorInput(directory, { async confirmDecodedAction() { return false; } });
  await assert.rejects(executeGovernanceMutationV1(rejected), /not confirmed/u);
  const secondDirectory = mkdtempSync(join(tmpdir(), "ameba-governance-success-test-"));
  try {
    const accepted = executorInput(secondDirectory);
    accepted.readAdapter = {
      async getGenesisHash() { return genesisHash; },
      async rereadPlanBindings() { rereads += 1; return { commitment: "finalized", contextSlot: BigInt(99 + rereads), bindings: bindings() }; },
      async observeAccounts() { return []; },
    };
    accepted.submission = { async submitSignedTransaction() { submissions += 1; return { signature: "mock-success" }; } };
    assert.deepEqual(await executeGovernanceMutationV1(accepted), { signature: "mock-success" });
    assert.equal(rereads, 3);
    assert.equal(submissions, 1);
  } finally {
    rmSync(secondDirectory, { recursive: true, force: true });
  }
}));

test("synthetic controller identity is rejected for production before lock acquisition", () => withTempDirectory(async (directory) => {
  const input = executorInput(directory);
  input.production = true;
  input.plan = planRelease1ProposalOperationV1({ ...bindings(), controllerProgram: (await import("./spreadGateBridgeV1.js")).SYNTHETIC_CONTROLLER_PROGRAM_V1 });
  input.armOperationId = input.plan.operationId;
  await assert.rejects(executeGovernanceMutationV1(input), /synthetic or default/u);
  assert.equal(existsSync(join(directory, "operator.lock")), false);
}));
