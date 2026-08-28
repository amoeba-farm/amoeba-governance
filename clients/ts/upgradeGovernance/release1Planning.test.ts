import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import * as publicPackage from "./index.js";
import { SYNTHETIC_CONTROLLER_PROGRAM_V1 } from "./spreadGateBridgeV1.js";

const b = (value: number): Buffer => Buffer.alloc(32, value);
const k = (value: number): PublicKey => new PublicKey(b(value));

test("public package exports account, Merkle, instruction, planning, and bridge namespaces", () => {
  assert.equal(publicPackage.release1Accounts.UPGRADE_PROPOSAL_V2_LEN, 1_792);
  assert.equal(publicPackage.artifactMerkleV1.RELEASE1_ARTIFACT_CHUNK_SIZE_V1, 16 * 1024);
  assert.equal(publicPackage.release1LifecycleInstructions.INITIALIZE_CONTROLLER_V1_TAG, 1);
  assert.equal(publicPackage.release1LoaderInstructions.OBSERVE_PROGRAMDATA_FAILURE_V1_TAG, 38);
  assert.equal(publicPackage.legacyV1.GOVERNANCE_TAIL_LEN, 16);
  assert.ok(publicPackage.spreadGateBridgeV1.SYNTHETIC_CONTROLLER_PROGRAM_V1 instanceof PublicKey);
});

test("finalized observation parsing rejects weaker commitment and hashes exact bytes", () => {
  const data = Buffer.from("canonical account bytes", "utf8");
  const response = { context: { slot: 42 }, value: { owner: k(2).toBase58(), lamports: 7, executable: false, rentEpoch: 9, data: [data.toString("base64"), "base64"] as const } };
  const observed = publicPackage.parseFinalizedAccountObservationV1(k(1), response, "finalized");
  assert.equal(observed.contextSlot, 42n);
  assert.deepEqual(observed.data, data);
  assert.equal(observed.dataSha256.toString("hex"), "86baffc4a97cf38f2cbff844b636da56177e6f51d4e524e8cf87e79f99777ac5");
  assert.throws(() => publicPackage.parseFinalizedAccountObservationV1(k(1), response, "confirmed"));
});

test("production identity, token defaults, cluster domain, and deterministic plans fail closed", () => {
  assert.throws(() => publicPackage.assertProductionControllerIdentityV1(SYNTHETIC_CONTROLLER_PROGRAM_V1));
  assert.throws(() => publicPackage.assertProductionControllerIdentityV1(PublicKey.default));
  publicPackage.assertProductionControllerIdentityV1(k(201));
  publicPackage.assertTokenGovernanceDisabledV1({ tokenGovernanceEnabled: false, voteProgram: PublicKey.default, voteProgramdata: PublicKey.default, voteConfig: PublicKey.default, voteMint: PublicKey.default });
  assert.throws(() => publicPackage.assertTokenGovernanceDisabledV1({ tokenGovernanceEnabled: true, voteProgram: PublicKey.default, voteProgramdata: PublicKey.default, voteConfig: PublicKey.default, voteMint: PublicKey.default }));

  const genesis = k(202).toBase58();
  publicPackage.assertClusterDomainV1(k(202).toBuffer(), genesis);
  assert.throws(() => publicPackage.assertClusterDomainV1(b(203), genesis));

  const bindings: publicPackage.Release1ProposalPlanBindingsV1 = {
    kind: publicPackage.Release1PlanKindV1.Upgrade, clusterDomain: b(1), controllerProgram: k(2), controllerConfig: k(3), targetProgram: k(4), targetProgramdata: k(5),
    authorityPda: k(6), programdataAuthority: k(6), protocolGate: k(7), gateEpoch: 8n, proposal: k(9), proposalDigest: b(10), councilVersion: 11n, councilHash: b(12), council: k(18),
    targetNonce: 13n, buffer: k(14), bufferAuthority: k(19), artifactSha256: b(15), artifactChunkMerkleRoot: b(16), checkpoint: k(20), checkpointDigest: b(17),
  };
  const plan = publicPackage.planRelease1ProposalOperationV1(bindings);
  assert.equal(plan.armed, false);
  assert.equal(plan.operationId.length, 64);
  publicPackage.assertRelease1PlanFreshV1(plan, bindings);
  assert.throws(() => publicPackage.assertRelease1PlanFreshV1(plan, { ...bindings, gateEpoch: 9n }));
  for (const field of ["proposalDigest", "councilHash", "artifactSha256", "artifactChunkMerkleRoot", "checkpointDigest"] as const) {
    assert.notEqual(publicPackage.release1ProposalPlanOperationIdV1({ ...bindings, [field]: b(99) }), plan.operationId);
  }
  for (const field of ["controllerProgram", "controllerConfig", "targetProgram", "targetProgramdata", "authorityPda", "programdataAuthority", "protocolGate", "proposal", "council", "buffer", "bufferAuthority", "checkpoint"] as const) {
    assert.notEqual(publicPackage.release1ProposalPlanOperationIdV1({ ...bindings, [field]: k(99) }), plan.operationId);
  }
  for (const field of ["gateEpoch", "councilVersion", "targetNonce"] as const) {
    assert.notEqual(publicPackage.release1ProposalPlanOperationIdV1({ ...bindings, [field]: 99n }), plan.operationId);
  }
});

test("journal redaction removes secret material without hiding public identities", () => {
  assert.deepEqual(publicPackage.redactGovernanceJournalValueV1({ controllerProgram: k(4), privateKey: "never", nested: { mnemonic: "never", operationId: "ok" } }), {
    controllerProgram: k(4).toBase58(), privateKey: "[REDACTED]", nested: { mnemonic: "[REDACTED]", operationId: "ok" },
  });
});
