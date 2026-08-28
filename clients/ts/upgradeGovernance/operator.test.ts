import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import { BufferVerificationStatusV1, GateStatusV1, ProposalStateV2 } from "./release1.js";
import { encodeApproveProposalV2 } from "./release1LifecycleInstructions.js";
import { encodeExecuteUpgradeV1 } from "./release1LoaderInstructions.js";
import {
  COMPUTE_BUDGET_PROGRAM_ID_V1,
  ExclusiveOperatorLockV1,
  GovernanceJournalV1,
  OperatorBackoffExitV1,
  RECENT_BLOCKHASHES_SYSVAR_ID_V1,
  RpcRateLimit429V1,
  SYSTEM_PROGRAM_ID_V1,
  executeGovernanceMutationV1,
  validatePreparedGovernanceTransactionV1,
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

function bindings(): Release1ProposalPlanBindingsV1 {
  return {
    kind: Release1PlanKindV1.ApproveProposal,
    clusterDomain: key(1).toBuffer(),
    controllerProgram: key(2),
    controllerConfig: key(3),
    targetProgram: key(4),
    targetProgramdata: key(5),
    authorityPda: key(6),
    programdataAuthority: key(6),
    protocolGate: key(7),
    gateEpoch: 8n,
    proposal: key(9),
    proposalDigest: bytes(10),
    councilVersion: 11n,
    councilHash: bytes(12),
    council: key(18),
    targetNonce: 13n,
    buffer: key(14),
    bufferAuthority: key(19),
    artifactSha256: bytes(15),
    artifactChunkMerkleRoot: bytes(16),
    checkpoint: key(20),
    checkpointDigest: bytes(17),
  };
}

const approvalData = encodeApproveProposalV2({
  expected: {
    expectedProposalDigest: bytes(10),
    expectedPolicyVersion: 1n,
    expectedPolicyHash: bytes(18),
    expectedCouncilVersion: 11n,
    expectedCouncilHash: bytes(12),
    expectedGateStatus: GateStatusV1.Active,
    expectedGateEpoch: 8n,
    expectedTargetNonce: 13n,
    expectedState: ProposalStateV2.BufferVerified,
    expectedReviewStartSlot: 20n,
    expectedReviewEndSlot: 30n,
    expectedNotBeforeSlot: 40n,
    expectedExpirySlot: 50n,
  },
  expectedApprovalBitset: 0,
  expectedApprovalCount: 0,
});

function prepared(): PreparedGovernanceTransactionV1 {
  return {
    controllerProgram: key(2),
    controllerInstructionData: approvalData,
    topLevelInstructions: [{
      kind: "controller",
      programId: key(2),
      data: approvalData,
      accounts: [],
    }],
    decodedAction: { command: "approve", proposal: key(9).toBase58() },
  };
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
      async compileMessage() { return Buffer.from("typed-message"); },
      async assembleSignedTransaction(_prepared, message, signature) { return Buffer.concat([message, signature]); },
    },
    signer: {
      providerKind: "kms",
      authority: key(20),
      async signMessage() { return Buffer.alloc(64, 21); },
    },
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
  journal.append(operationId, "plan", { privateKey: "do-not-write", nested: { authorization: "Bearer token", safe: "visible" } });
  journal.append(operationId, "confirmed", { ok: true });
  const raw = readFileSync(path, "utf8");
  assert.equal(raw.includes("do-not-write"), false);
  assert.equal(raw.includes("Bearer token"), false);
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

test("typed loader action accepts only its exact nonce/compute/controller envelope", () => {
  const base = bindings();
  const plan = planRelease1ProposalOperationV1({ ...base, kind: Release1PlanKindV1.Upgrade });
  const nonce = key(40);
  const nonceAuthority = key(41);
  const data = encodeExecuteUpgradeV1({
    expected: {
      expectedProposalDigest: bytes(10), expectedPolicyVersion: 1n, expectedPolicyHash: bytes(42), expectedCouncilVersion: 11n, expectedCouncilHash: bytes(12),
      expectedGateStatus: GateStatusV1.FrozenForUpgrade, expectedGateEpoch: 8n, expectedTargetNonce: 13n, expectedState: ProposalStateV2.Frozen,
      expectedReviewStartSlot: 20n, expectedReviewEndSlot: 30n, expectedNotBeforeSlot: 40n, expectedExpirySlot: 50n,
    },
    expectedPrestateCheckpointDigest: bytes(17), expectedCurrentRawProgramdataHash: bytes(43), expectedSealedBufferHeaderHash: bytes(44),
    expectedCounterpartProposalDigest: bytes(45), expectedProgramdataSlot: 46n, expectedCapacity: 47n, expectedVerifiedChunkCount: 1,
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
    decodedAction: { instruction: "ExecuteUpgradeV1" },
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
    signer: { providerKind: "hardware", authority: key(20), async signMessage() { signed += 1; return Buffer.alloc(64); } },
    submission: { async submitSignedTransaction() { submitted += 1; return { signature: "forbidden" }; } },
  });
  await assert.rejects(executeGovernanceMutationV1(input), /stale or mutated/u);
  assert.equal(signed, 0);
  assert.equal(submitted, 0);
  assert.equal(existsSync(join(directory, "operator.lock")), false);
}));

test("mandatory second reread catches a freeze race after signing", () => withTempDirectory(async (directory) => {
  let rereads = 0;
  let signed = 0;
  let submitted = 0;
  const input = executorInput(directory);
  input.readAdapter = {
    async getGenesisHash() { return genesisHash; },
    async rereadPlanBindings() { rereads += 1; return { commitment: "finalized", contextSlot: BigInt(99 + rereads), bindings: rereads === 1 ? bindings() : { ...bindings(), targetNonce: 500n } }; },
    async observeAccounts() { return []; },
  };
  input.signer = { providerKind: "wallet", authority: key(20), async signMessage() { signed += 1; return Buffer.alloc(64); } };
  input.submission = { async submitSignedTransaction() { submitted += 1; return { signature: "forbidden" }; } };
  await assert.rejects(executeGovernanceMutationV1(input), /stale or mutated/u);
  assert.equal(rereads, 2);
  assert.equal(signed, 1);
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

test("decoded action confirmation is mandatory and successful mock path rereads twice", () => withTempDirectory(async (directory) => {
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
    assert.equal(rereads, 2);
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
