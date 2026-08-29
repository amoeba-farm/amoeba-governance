import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import * as publicSurface from "./index.js";
import {
  RELEASE1_PHASE7_READINESS_ONLY_COMMANDS_V1,
  RELEASE1_PUBLIC_SCHEMA_V1,
  UPGRADE_GOVERNANCE_CLI_COMMANDS_V1,
  runUpgradeGovernanceCliV1,
  type UpgradeGovernanceCliAdaptersV1,
} from "./cli.js";
import {
  runUpgradeGovernanceExecutableV1,
  UPGRADE_GOVERNANCE_EXECUTABLE_USAGE_V1,
} from "./cliMain.js";
import { ExclusiveOperatorLockV1, GovernanceJournalV1 } from "./operator.js";
import {
  BufferVerificationStatusV1,
  GateStatusV1,
  ProgramDataVerificationStatusV1,
  ProposalStateV2,
  StateCheckpointPhaseV1,
} from "./release1.js";
import { encodeApproveProposalV3 } from "./release1V3Instructions.js";
import {
  FINALIZED_COMMITMENT,
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
    { pubkey: key(32), isSigner: false, isWritable: false },
    { pubkey: key(33), isSigner: false, isWritable: false },
    { pubkey: key(9), isSigner: false, isWritable: true },
    { pubkey: key(34), isSigner: false, isWritable: false },
    { pubkey: key(40), isSigner: true, isWritable: false },
  ] as const;
}

function bindings(kind: Release1PlanKindV1 = Release1PlanKindV1.ApproveProposal): Release1ProposalPlanBindingsV1 {
  return {
    kind,
    clusterDomain: key(1).toBuffer(),
    controllerProgram: key(2), controllerConfig: key(3), controllerInstructionData: approveData,
    controllerInstructionAccounts: approveAccounts(), controllerLookupTable: null,
    targetProgram: key(4), targetProgramdata: key(5), authorityPda: key(6), programdataAuthority: key(6),
    protocolGate: key(7), gateStatus: GateStatusV1.Active, gateEpoch: 8n,
    proposal: key(9), proposalDigest: bytes(10), proposalState: ProposalStateV2.BufferVerified,
    reviewStartSlot: 20n, reviewEndSlot: 30n, notBeforeSlot: 40n, expirySlot: 50n,
    councilVersion: 11n, councilHash: bytes(12), council: key(18), targetNonce: 13n,
    programdataDeployedSlot: 21n, programdataCapacity: 1_000n,
    buffer: key(14), bufferAuthority: key(19), bufferVerificationStatus: BufferVerificationStatusV1.Verified,
    bufferVerifiedChunkCount: 1, bufferChunkCount: 1,
    artifactSha256: bytes(15), artifactChunkMerkleRoot: bytes(16),
    programdataVerificationStatus: ProgramDataVerificationStatusV1.Verifying,
    programdataVerifiedPayloadChunkCount: 0, programdataVerifiedZeroTailChunkCount: 0,
    checkpoint: key(20), checkpointDigest: bytes(17), checkpointPhase: StateCheckpointPhaseV1.Prestate, checkpointAccepted: false,
  };
}

const approveData = encodeApproveProposalV3({
  expected: {
    expectedProposalDigest: bytes(10), expectedState: ProposalStateV2.BufferVerified,
    expectedGateStatus: GateStatusV1.Active, expectedGateEpoch: 8n, expectedTargetNonce: 13n,
    expectedCapacityPolicyDigest: bytes(32), expectedCurrentDeploymentDigest: bytes(33), expectedCurrentDeploymentGeneration: 1n,
  },
  expectedCreationCouncilVersion: 11n,
  expectedCreationCouncilHash: bytes(12),
  expectedApprovalBitset: 0,
  expectedApprovalCount: 0,
});

function adapters(directory: string): UpgradeGovernanceCliAdaptersV1 & { counters: { planned: number; sourceReads: number; dependencies: number; submitted: number } } {
  const counters = { planned: 0, sourceReads: 0, dependencies: 0, submitted: 0 };
  return {
    counters,
    readAdapter: {
      async getGenesisHash() { return genesisHash; },
      async rereadPlanBindings(plan) { return { commitment: "finalized", contextSlot: 100n, bindings: { ...bindings(plan.kind) } }; },
      async observeAccounts(pubkeys) {
        return pubkeys.map((pubkey) => ({
          pubkey,
          contextSlot: 99n,
          owner: key(30),
          lamports: 1n,
          executable: false,
          rentEpoch: 0n,
          data: Buffer.from([1, 2, 3]),
          dataSha256: bytes(31),
          commitment: FINALIZED_COMMITMENT,
        }));
      },
    },
    receiptFinalizedSourceReader: {
      async readFinalizedFrozenHistory() { counters.sourceReads += 1; throw new Error("test receipt source was not configured"); },
      async readFinalizedAccountSnapshots() { counters.sourceReads += 1; throw new Error("test receipt source was not configured"); },
      async readFinalizedOldAuthorityRejection() { counters.sourceReads += 1; throw new Error("test receipt source was not configured"); },
    },
    planner: {
      async plan(command) {
        counters.planned += 1;
        const kind = command === "plan-controller-immutability" ? Release1PlanKindV1.PlanControllerImmutability : command === "plan-authority-handoff" ? Release1PlanKindV1.PlanAuthorityHandoff : Release1PlanKindV1.ApproveProposal;
        return planRelease1ProposalOperationV1(bindings(kind));
      },
    },
    createPlanningSafety() {
      return {
        journal: new GovernanceJournalV1(join(directory, "planning.jsonl")),
        lock: new ExclusiveOperatorLockV1(join(directory, "planning.lock")),
      };
    },
    async createMutationDependencies(_command, plan) {
      counters.dependencies += 1;
      return {
        expectedGenesisHash: genesisHash,
        production: false,
        readAdapter: {
          async getGenesisHash() { return genesisHash; },
          async rereadPlanBindings() { return { commitment: "finalized", contextSlot: 100n, bindings: bindings(plan.kind) }; },
          async observeAccounts() { return []; },
        },
        transactionAdapter: {
          async prepare() {
            return {
              controllerProgram: key(2),
              controllerInstructionData: approveData,
              feePayer: key(41),
              recentBlockhash: key(60).toBase58(),
              messageVersion: "legacy" as const,
              addressLookupTableAccounts: [],
              topLevelInstructions: [{ kind: "controller" as const, programId: key(2), data: approveData, accounts: approveAccounts() }],
            };
          },
          async compileMessage(prepared) {
            const instructions = prepared.topLevelInstructions.map((instruction) => new TransactionInstruction({
              programId: instruction.programId,
              data: instruction.data,
              keys: instruction.accounts.map((account) => ({ ...account })),
            }));
            return Buffer.from(new TransactionMessage({
              payerKey: prepared.feePayer,
              recentBlockhash: prepared.recentBlockhash,
              instructions,
            }).compileToLegacyMessage().serialize());
          },
          async assembleSignedTransaction(_prepared, message, signatures) {
            const transaction = new VersionedTransaction(VersionedMessage.deserialize(message));
            for (const entry of signatures) transaction.addSignature(entry.authority, entry.signature);
            return Buffer.from(transaction.serialize());
          },
        },
        signers: [
          { providerKind: "kms" as const, authority: key(41), async signMessage() { return Buffer.alloc(64, 41); } },
          { providerKind: "kms" as const, authority: key(40), async signMessage() { return Buffer.alloc(64, 40); } },
        ],
        submission: { async submitSignedTransaction() { counters.submitted += 1; return { signature: "mock-signature" }; } },
        async confirmDecodedAction() { return true; },
        journal: new GovernanceJournalV1(join(directory, "journal.jsonl")),
        lock: new ExclusiveOperatorLockV1(join(directory, "operator.lock")),
      };
    },
  };
}

function temporary(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "ameba-governance-cli-test-"));
  return run(directory).finally(() => rmSync(directory, { recursive: true, force: true }));
}

test("CLI exposes the complete required command set and marks Phase 7 commands read-only", () => {
  assert.deepEqual(UPGRADE_GOVERNANCE_CLI_COMMANDS_V1, [
    "schema", "observe", "plan-initialize", "plan-proposal", "adopt-buffer", "verify-buffer", "approve", "finalize-governance", "queue", "guardian-freeze",
    "plan-emergency-resolution", "create-emergency-resolution", "approve-emergency-resolution", "queue-emergency-resolution", "execute-emergency-resolution",
    "freeze", "bind-prestate", "approve-checkpoint", "execute-extension", "execute-upgrade", "verify-programdata", "bind-poststate",
    "approve-unfreeze", "unfreeze", "cancel", "expire", "close-buffer", "plan-rollback", "observe-programdata-failure", "activate-rollback",
    "create-council-set", "rotate-council", "plan-controller-immutability",
    "plan-authority-handoff", "verify-handoff",
  ]);
  assert.deepEqual(RELEASE1_PHASE7_READINESS_ONLY_COMMANDS_V1, ["plan-controller-immutability", "plan-authority-handoff", "verify-handoff"]);
  assert.equal(RELEASE1_PUBLIC_SCHEMA_V1.tokenGovernanceEnabled, false);
  assert.deepEqual(RELEASE1_PUBLIC_SCHEMA_V1.instructionTags, {
    CreateCandidateCouncilSetV1: 18,
    CreateCouncilRotationV1: 19,
    ApproveCouncilRotationV1: 20,
    ActivateCouncilRotationV1: 21,
    QueueCouncilRotationV1: 22,
    CancelCouncilRotationV1: 24,
    ExpireCouncilRotationV1: 25,
    BeginProgramDataObservationV1: 39,
    AppendProgramDataObservationChunkV1: 40,
    VerifyObservedArtifactChunkV1: 41,
    FinalizeProgramDataObservationV1: 42,
    RecordControllerImmutabilityV1: 43,
    CreateTargetAuthorityHandoffV1: 44,
    ApproveTargetAuthorityHandoffV1: 45,
    QueueTargetAuthorityHandoffV1: 46,
    AcceptTargetAuthorityCheckedV1: 47,
    CreateBootstrapActivationV1: 49,
    ApproveBootstrapActivationV1: 50,
    QueueBootstrapActivationV1: 51,
    ExecuteBootstrapActivationV1: 52,
    InitializeControllerV2: 53,
    CreateProposalV3: 54,
    ApproveProposalV3: 55,
    FinalizeGovernanceV3: 56,
    QueueProposalV3: 57,
    FreezeProposalV3: 58,
    CancelProposalV3: 59,
    ExpireProposalV3: 60,
    GuardianFreezeV2: 61,
    CreateEmergencyResolutionV2: 62,
    ApproveEmergencyResolutionV2: 63,
    QueueEmergencyResolutionV2: 64,
    ExecuteEmergencyResolutionV2: 65,
    ExpireEmergencyResolutionV2: 66,
    CreateCheckpointV2: 67,
    RecastCheckpointV2: 68,
    FinalizeCheckpointV2: 69,
    BindProgramDataVerificationV2: 70,
    FinalizeProgramDataVerificationV2: 71,
    ObserveProgramDataFailureV2: 72,
    ApproveUnfreezeV2: 73,
    ExecuteUnfreezeV2: 74,
    AdoptBufferV2: 75,
    VerifyBufferChunkV2: 76,
    FinalizeBufferVerificationV2: 77,
    ExtendTargetV2: 78,
    ExecuteUpgradeV2: 79,
    CloseAbandonedBufferV2: 80,
    ActivateRollbackV2: 81,
  });
  assert.deepEqual(RELEASE1_PUBLIC_SCHEMA_V1.executableInstructionTagRanges, [
    [18, 22], [24, 25], [39, 47], [49, 52], [53, 81],
  ]);
  assert.deepEqual(RELEASE1_PUBLIC_SCHEMA_V1.rejectedInstructionTags, [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
    23, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 48,
  ]);
});

test("installed executable requires one explicit local injected-adapter module", () => temporary(async (directory) => {
  const output: string[] = [];
  const errors: string[] = [];
  const a = adapters(directory);
  let loadedPath = "";
  const code = await runUpgradeGovernanceExecutableV1(
    ["--adapter-module", "./operator-adapter.mjs", "schema"],
    { stdout(value) { output.push(value); }, stderr(value) { errors.push(value); } },
    async (absolutePath) => {
      loadedPath = absolutePath;
      return { createUpgradeGovernanceCliAdaptersV1: () => a };
    },
  );
  assert.equal(code, 0);
  assert.equal(loadedPath.endsWith("operator-adapter.mjs"), true);
  assert.equal(JSON.parse(output.join("")).status, "schema");
  assert.equal(errors.length, 0);
  output.length = 0;
  assert.equal(await runUpgradeGovernanceExecutableV1(["--help"], {
    stdout(value) { output.push(value); }, stderr(value) { errors.push(value); },
  }), 0);
  assert.equal(output.join(""), UPGRADE_GOVERNANCE_EXECUTABLE_USAGE_V1);
  await assert.rejects(runUpgradeGovernanceExecutableV1(["schema"], {
    stdout() {}, stderr() {},
  }), /adapter-module is required/u);
  await assert.rejects(runUpgradeGovernanceExecutableV1([
    "--adapter-module", "https://example.invalid/adapter.mjs", "schema",
  ], { stdout() {}, stderr() {} }), /local file path/u);
}));

test("schema and finalized observe paths never construct execution dependencies", () => temporary(async (directory) => {
  const a = adapters(directory);
  assert.equal((await runUpgradeGovernanceCliV1(["schema"], a)).status, "schema");
  const payload = JSON.stringify({ clusterDomainHex: key(1).toBuffer().toString("hex"), accounts: [key(50).toBase58()] });
  const observed = await runUpgradeGovernanceCliV1(["observe", `--payload-json=${payload}`], a);
  assert.equal(observed.status, "observed");
  assert.equal(a.counters.dependencies, 0);
  assert.equal(a.counters.submitted, 0);
}));

test("planning-only commands reject arming and handoff verification uses the built-in receipt verifier", () => temporary(async (directory) => {
  const a = adapters(directory);
  for (const command of RELEASE1_PHASE7_READINESS_ONLY_COMMANDS_V1) {
    await assert.rejects(runUpgradeGovernanceCliV1([command, `--arm=${"aa".repeat(32)}`], a), /cannot be armed|read-only/u);
  }
  assert.equal(a.counters.dependencies, 0);
  assert.equal(a.counters.submitted, 0);
  const handoffPayload = JSON.stringify({ clusterDomainHex: key(1).toBuffer().toString("hex") });
  await assert.rejects(
    runUpgradeGovernanceCliV1(["verify-handoff", `--payload-json=${handoffPayload}`], a),
    /requires exactly payload\.clusterDomainHex and payload\.receipt/u,
  );
  const malformedReceipt = JSON.stringify({
    clusterDomainHex: key(1).toBuffer().toString("hex"),
    receipt: {},
  });
  await assert.rejects(
    runUpgradeGovernanceCliV1(["verify-handoff", `--payload-json=${malformedReceipt}`], a),
    /receipt: contains missing or unknown schema fields/u,
  );
  assert.equal(a.counters.sourceReads, 0);
}));

test("mutation command plans by default and exact arming invokes only injected providers", () => temporary(async (directory) => {
  const a = adapters(directory);
  const planned = await runUpgradeGovernanceCliV1(["approve"], a);
  assert.equal(planned.status, "planned");
  assert.equal(a.counters.dependencies, 0);
  if (planned.status !== "planned") throw new Error("unreachable");
  const submitted = await runUpgradeGovernanceCliV1(["approve", `--arm=${planned.plan.operationId}`], a);
  assert.deepEqual(submitted, { status: "submitted", command: "approve", operationId: planned.plan.operationId, signature: "mock-signature" });
  assert.equal(a.counters.dependencies, 1);
  assert.equal(a.counters.submitted, 1);
}));

test("first planning-stage 429 is journaled with backoff and exits without retry", () => temporary(async (directory) => {
  const a = adapters(directory);
  let attempts = 0;
  a.planner.plan = async () => {
    attempts += 1;
    throw { status: 429, retryAfterMs: 12_345 };
  };
  await assert.rejects(runUpgradeGovernanceCliV1(["plan-proposal"], a), /operator exited after first 429/u);
  assert.equal(attempts, 1);
  const journal = readFileSync(join(directory, "planning.jsonl"), "utf8");
  assert.equal(journal.includes('"event":"rate-limit-exit"'), true);
  assert.equal(journal.includes('"retryAfterMs":12345'), true);
}));

test("CLI rejects secret-bearing payloads, duplicate options, unknown commands, and stale-genesis plans", () => temporary(async (directory) => {
  const a = adapters(directory);
  await assert.rejects(runUpgradeGovernanceCliV1(["plan-proposal", "--payload-json", JSON.stringify({ privateKey: [1, 2, 3] })], a), /forbidden/u);
  await assert.rejects(runUpgradeGovernanceCliV1(["plan-proposal", "--payload-json", JSON.stringify({ private_key: [1, 2, 3] })], a), /forbidden/u);
  await assert.rejects(runUpgradeGovernanceCliV1(["plan-proposal", "--payload-json", JSON.stringify({ nested: { seed_phrase: "never", walletKeypair: [1, 2, 3] } })], a), /forbidden/u);
  await assert.rejects(runUpgradeGovernanceCliV1(["plan-proposal", "--payload-json={}", "--payload-json={}"], a), /only once/u);
  await assert.rejects(runUpgradeGovernanceCliV1(["not-a-command"], a), /unknown or missing/u);
  a.readAdapter.getGenesisHash = async () => key(99).toBase58();
  await assert.rejects(runUpgradeGovernanceCliV1(["plan-proposal"], a), /connected genesis/u);
}));

test("public operator sources expose no private-key, environment-secret, or raw-instruction constructor fallback", () => {
  const source = ["cli.ts", "operator.ts"].map((file) => readFileSync(new URL(file, import.meta.url), "utf8")).join("\n");
  assert.equal(/\bKeypair\b/u.test(source), false);
  assert.equal(/process\.env/u.test(source), false);
  assert.equal(/fromSecretKey|secretKeyTo|read.*keypair/iu.test(source), false);
  assert.equal(Object.keys(publicSurface).some((name) => /raw.*instruction|instruction.*raw/iu.test(name)), false);
});
