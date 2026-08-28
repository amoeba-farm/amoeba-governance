import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import * as publicSurface from "./index.js";
import {
  RELEASE1_PHASE7_READINESS_ONLY_COMMANDS_V1,
  RELEASE1_PUBLIC_SCHEMA_V1,
  UPGRADE_GOVERNANCE_CLI_COMMANDS_V1,
  runUpgradeGovernanceCliV1,
  type UpgradeGovernanceCliAdaptersV1,
} from "./cli.js";
import { ExclusiveOperatorLockV1, GovernanceJournalV1 } from "./operator.js";
import { GateStatusV1, ProposalStateV2 } from "./release1.js";
import { encodeApproveProposalV2 } from "./release1LifecycleInstructions.js";
import {
  FINALIZED_COMMITMENT,
  Release1PlanKindV1,
  planRelease1ProposalOperationV1,
  type Release1ProposalPlanBindingsV1,
} from "./release1Planning.js";

const bytes = (value: number): Buffer => Buffer.alloc(32, value);
const key = (value: number): PublicKey => new PublicKey(bytes(value));
const genesisHash = key(1).toBase58();

function bindings(kind: Release1PlanKindV1 = Release1PlanKindV1.ApproveProposal): Release1ProposalPlanBindingsV1 {
  return {
    kind,
    clusterDomain: key(1).toBuffer(),
    controllerProgram: key(2), controllerConfig: key(3), targetProgram: key(4), targetProgramdata: key(5), authorityPda: key(6), programdataAuthority: key(6), protocolGate: key(7), gateEpoch: 8n,
    proposal: key(9), proposalDigest: bytes(10), councilVersion: 11n, councilHash: bytes(12), council: key(18), targetNonce: 13n, buffer: key(14), bufferAuthority: key(19), artifactSha256: bytes(15), artifactChunkMerkleRoot: bytes(16), checkpoint: key(20), checkpointDigest: bytes(17),
  };
}

const approveData = encodeApproveProposalV2({
  expected: {
    expectedProposalDigest: bytes(10), expectedPolicyVersion: 1n, expectedPolicyHash: bytes(18), expectedCouncilVersion: 11n, expectedCouncilHash: bytes(12),
    expectedGateStatus: GateStatusV1.Active, expectedGateEpoch: 8n, expectedTargetNonce: 13n, expectedState: ProposalStateV2.BufferVerified,
    expectedReviewStartSlot: 20n, expectedReviewEndSlot: 30n, expectedNotBeforeSlot: 40n, expectedExpirySlot: 50n,
  },
  expectedApprovalBitset: 0,
  expectedApprovalCount: 0,
});

function adapters(directory: string): UpgradeGovernanceCliAdaptersV1 & { counters: { planned: number; verified: number; dependencies: number; submitted: number } } {
  const counters = { planned: 0, verified: 0, dependencies: 0, submitted: 0 };
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
    planner: {
      async plan(command) {
        counters.planned += 1;
        const kind = command === "plan-controller-immutability" ? Release1PlanKindV1.PlanControllerImmutability : command === "plan-authority-handoff" ? Release1PlanKindV1.PlanAuthorityHandoff : Release1PlanKindV1.ApproveProposal;
        return planRelease1ProposalOperationV1(bindings(kind));
      },
      async verifyHandoff() { counters.verified += 1; return { verified: true, mode: "mock-read-only" }; },
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
              topLevelInstructions: [{ kind: "controller" as const, programId: key(2), data: approveData, accounts: [] }],
              decodedAction: { instruction: "ApproveProposalV2" },
            };
          },
          async compileMessage() { return Buffer.from("message"); },
          async assembleSignedTransaction(_prepared, message, signature) { return Buffer.concat([message, signature]); },
        },
        signer: { providerKind: "kms" as const, authority: key(40), async signMessage() { return Buffer.alloc(64); } },
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
    "plan-emergency-resolution", "freeze", "bind-prestate", "approve-checkpoint", "execute-extension", "execute-upgrade", "verify-programdata", "bind-poststate",
    "approve-unfreeze", "unfreeze", "cancel", "expire", "close-buffer", "plan-rollback", "create-council-set", "rotate-council", "plan-controller-immutability",
    "plan-authority-handoff", "verify-handoff",
  ]);
  assert.deepEqual(RELEASE1_PHASE7_READINESS_ONLY_COMMANDS_V1, ["plan-controller-immutability", "plan-authority-handoff", "verify-handoff"]);
  assert.equal(RELEASE1_PUBLIC_SCHEMA_V1.tokenGovernanceEnabled, false);
  assert.deepEqual(RELEASE1_PUBLIC_SCHEMA_V1.rejectedInstructionTags, [0, 26]);
});

test("schema and finalized observe paths never construct execution dependencies", () => temporary(async (directory) => {
  const a = adapters(directory);
  assert.equal((await runUpgradeGovernanceCliV1(["schema"], a)).status, "schema");
  const payload = JSON.stringify({ clusterDomainHex: key(1).toBuffer().toString("hex"), accounts: [key(50).toBase58()] });
  const observed = await runUpgradeGovernanceCliV1(["observe", `--payload-json=${payload}`], a);
  assert.equal(observed.status, "observed");
  assert.equal(a.counters.dependencies, 0);
  assert.equal(a.counters.submitted, 0);
}));

test("planning-only and handoff verification commands reject arming", () => temporary(async (directory) => {
  const a = adapters(directory);
  for (const command of RELEASE1_PHASE7_READINESS_ONLY_COMMANDS_V1) {
    await assert.rejects(runUpgradeGovernanceCliV1([command, `--arm=${"aa".repeat(32)}`], a), /cannot be armed|read-only/u);
  }
  assert.equal(a.counters.dependencies, 0);
  assert.equal(a.counters.submitted, 0);
  const handoffPayload = JSON.stringify({ clusterDomainHex: key(1).toBuffer().toString("hex") });
  const verified = await runUpgradeGovernanceCliV1(["verify-handoff", `--payload-json=${handoffPayload}`], a);
  assert.deepEqual(verified, { status: "verified", command: "verify-handoff", result: { verified: true, mode: "mock-read-only" } });
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

test("CLI rejects secret-bearing payloads, duplicate options, unknown commands, and stale-genesis plans", () => temporary(async (directory) => {
  const a = adapters(directory);
  await assert.rejects(runUpgradeGovernanceCliV1(["plan-proposal", "--payload-json", JSON.stringify({ privateKey: [1, 2, 3] })], a), /forbidden/u);
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
