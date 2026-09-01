import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tool = path.join(root, "tools", "devnet-governance-v2-handoff-activation.mjs");

test("V2 handoff/activation tool self-test pins exact execute tags and packet regressions", () => {
  const result = spawnSync(process.execPath, [tool, "self-test"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env },
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.schema, "ameba-governance-devnet-v2-handoff-activation-self-test-v1");
  assert.deepEqual(value.tags, { handoffExecute: 101, activationExecute: 107 });
  assert.deepEqual(value.accountCounts, { handoffExecute: 21, activationExecute: 22 });
  assert.deepEqual(value.packetBytes, { handoffExecute: 794, activationExecute: 827 });
  assert.equal(value.injectedSignerOnly, true);
  assert.equal(value.oldV1LifecycleBuildersAbsent, true);
  assert.equal(value.authorityFinalAndOnchainRecordEvidenceSeparated, true);
  assert.equal(value.runtime.firstRateLimitCallCount, 1);
  assert.equal(value.runtime.ambiguousPreparedTransactionSendCalls, 0);
});

test("V2 handoff/activation tool exposes only the narrow plan/execute surface", () => {
  const source = readFileSync(tool, "utf8");
  for (const command of [
    "status-handoff", "plan-handoff-next", "execute-handoff-next",
    "status-activation", "plan-activation-next", "execute-activation-next",
  ]) assert(source.includes(`\"${command}\"`), `missing command ${command}`);
  for (const builder of [
    "buildCreateTargetAuthorityHandoffProposalV2Instruction",
    "buildApproveTargetAuthorityHandoffProposalV2Instruction",
    "buildQueueTargetAuthorityHandoffProposalV2Instruction",
    "buildExecuteTargetAuthorityHandoffProposalV2Instruction",
    "buildCreateBootstrapActivationProposalV2Instruction",
    "buildApproveBootstrapActivationProposalV2Instruction",
    "buildQueueBootstrapActivationProposalV2Instruction",
    "buildExecuteBootstrapActivationProposalV2Instruction",
  ]) assert(source.includes(builder), `missing V2 builder ${builder}`);
  assert(source.includes("AMEBA_GOVERNANCE_V2_SIGNER_PROVIDER"));
  assert(source.includes("AMEBA_GOVERNANCE_V2_FORMER_AUTHORITY_CLOSE_RECEIPT"));
  assert(source.includes("formerAuthorityBoundaryReceiptSha256"));
  assert(source.includes("AMOEBA_GOVERNANCE_V2_FORMER_AUTHORITY_PROOF_BUFFER_CLOSE_V1"));
  assert(source.includes("controller-immutability-authority-final-receipt-v1.json"));
  assert(source.includes("controllerAuthorityFinal.sha256"));
  assert(source.includes("immutabilityRecord.sha256"));
  assert(!source.includes("review.controllerImmutabilityReceiptSha256, immutabilityRecord.sha256"));
  assert(source.includes("signTransactionWithProvider"));
  assert(source.includes("submitOneFinalized"));
  assert(source.includes("reconcileOneFinalized"));
  assert(!source.includes(["loadSecure", "Keypair"].join("")));
  assert(!source.includes(["buildCreateTargetAuthorityHandoff", "V1Instruction"].join("")));
  assert(!source.includes(["buildCreateBootstrapActivation", "V1Instruction"].join("")));
});

test("V2 handoff/activation tool refuses missing evidence before any RPC command", () => {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (name.startsWith("AMEBA_")) delete environment[name];
  }
  const result = spawnSync(process.execPath, [tool, "status-handoff"], {
    cwd: root,
    encoding: "utf8",
    env: environment,
    timeout: 30_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /AMEBA_GOVERNANCE_V2_BASE_DESCRIPTOR is required/u);
  assert.doesNotMatch(result.stderr, /getGenesisHash|sendRawTransaction/u);
});
