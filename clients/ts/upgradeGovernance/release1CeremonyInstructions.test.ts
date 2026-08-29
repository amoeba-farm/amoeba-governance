import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { PublicKey, SystemProgram } from "@solana/web3.js";

import { ARTIFACT_MERKLE_SCHEME_ID } from "./artifactMerkleV1.js";
import { GateStatusV1 } from "./release1.js";
import {
  ProgramDataObservationPurposeV1,
  ProgramDataObservationStatusV1,
} from "./release1Ceremony.js";
import {
  APPEND_PROGRAMDATA_OBSERVATION_CHUNK_V1_LEN,
  BEGIN_PROGRAMDATA_OBSERVATION_V1_LEN,
  FINALIZE_PROGRAMDATA_OBSERVATION_V1_LEN,
  VERIFY_OBSERVED_ARTIFACT_CHUNK_V1_LEN,
  buildAppendProgramDataObservationChunkV1Instruction,
  buildBeginProgramDataObservationV1Instruction,
  buildFinalizeProgramDataObservationV1Instruction,
  buildVerifyObservedArtifactChunkV1Instruction,
  decodeAppendProgramDataObservationChunkV1,
  decodeBeginProgramDataObservationV1,
  decodeFinalizeProgramDataObservationV1,
  decodeVerifyObservedArtifactChunkV1,
  encodeAppendProgramDataObservationChunkV1,
  encodeBeginProgramDataObservationV1,
  encodeFinalizeProgramDataObservationV1,
  encodeVerifyObservedArtifactChunkV1,
  type BeginProgramDataObservationV1,
  type ProgramDataObservationGuardV1,
} from "./release1CeremonyInstructions.js";

function digest(label: string): Buffer {
  return createHash("sha256").update(label, "utf8").digest();
}

function key(label: string): PublicKey {
  return new PublicKey(digest(`ceremony-instruction:${label}`));
}

function guard(): ProgramDataObservationGuardV1 {
  return {
    purpose: ProgramDataObservationPurposeV1.PostUpgrade,
    generation: 7n,
    expectedSubjectDigest: digest("subject"),
    expectedGateStatus: GateStatusV1.FrozenForUpgrade,
    expectedGateEpoch: 9n,
    expectedFreezeReasonCode: 4,
    expectedFreezeSlot: 123n,
  };
}

function begin(): BeginProgramDataObservationV1 {
  return {
    guard: guard(),
    expectedCapacityPolicyDigest: digest("capacity-policy"),
    expectedArtifactLength: 8_192n,
    expectedArtifactSha256: digest("artifact-sha256"),
    expectedArtifactMerkleRoot: digest("artifact-root"),
    expectedArtifactSchemeId: Buffer.from(ARTIFACT_MERKLE_SCHEME_ID),
    minimumRequiredCapacity: 9_000n,
    expectedDeployedSlot: 555n,
    expectedActualCapacity: 10_000n,
    expectedUpgradeAuthority: { present: true, value: key("authority") },
  };
}

const proof = {
  proofLen: 1,
  nodes: [digest("sibling"), ...Array.from({ length: 6 }, () => Buffer.alloc(32))],
};

test("observation instruction codecs are fixed, canonical, and round-trip", () => {
  const beginData = encodeBeginProgramDataObservationV1(begin());
  assert.equal(beginData.length, BEGIN_PROGRAMDATA_OBSERVATION_V1_LEN);
  assert.deepEqual(encodeBeginProgramDataObservationV1(decodeBeginProgramDataObservationV1(beginData)), beginData);

  const append = {
    guard: guard(),
    expectedStatus: ProgramDataObservationStatusV1.Accumulating,
    chunkIndex: 3,
  };
  const appendData = encodeAppendProgramDataObservationChunkV1(append);
  assert.equal(appendData.length, APPEND_PROGRAMDATA_OBSERVATION_CHUNK_V1_LEN);
  assert.deepEqual(encodeAppendProgramDataObservationChunkV1(decodeAppendProgramDataObservationChunkV1(appendData)), appendData);

  const verify = {
    guard: guard(),
    expectedStatus: ProgramDataObservationStatusV1.Accumulating,
    chunkIndex: 2,
    expectedNextArtifactChunkIndex: 2,
    expectedTailBytesVerified: 0n,
    proof,
  };
  const verifyData = encodeVerifyObservedArtifactChunkV1(verify);
  assert.equal(verifyData.length, VERIFY_OBSERVED_ARTIFACT_CHUNK_V1_LEN);
  assert.deepEqual(encodeVerifyObservedArtifactChunkV1(decodeVerifyObservedArtifactChunkV1(verifyData)), verifyData);

  const finalize = {
    guard: guard(),
    expectedStatus: ProgramDataObservationStatusV1.ReadyToFinalize,
    expectedNextRawChunkIndex: 1,
    expectedNextArtifactChunkIndex: 3,
    expectedTailBytesVerified: 1_808n,
  };
  const finalizeData = encodeFinalizeProgramDataObservationV1(finalize);
  assert.equal(finalizeData.length, FINALIZE_PROGRAMDATA_OBSERVATION_V1_LEN);
  assert.deepEqual(encodeFinalizeProgramDataObservationV1(decodeFinalizeProgramDataObservationV1(finalizeData)), finalizeData);
});

test("observation instruction codecs reject semantic and canonicality drift", () => {
  assert.throws(() => encodeBeginProgramDataObservationV1({
    ...begin(),
    expectedArtifactSchemeId: digest("wrong-scheme"),
  }), /noncanonical/);

  assert.throws(() => encodeBeginProgramDataObservationV1({
    ...begin(),
    guard: { ...guard(), expectedGateStatus: GateStatusV1.Active },
  }), /gate snapshot/);

  assert.throws(() => encodeVerifyObservedArtifactChunkV1({
    guard: guard(),
    expectedStatus: ProgramDataObservationStatusV1.Accumulating,
    chunkIndex: 0,
    expectedNextArtifactChunkIndex: 0,
    expectedTailBytesVerified: 0n,
    proof: { ...proof, proofLen: 0 },
  }), /unused proof/);

  const zeroGeneration = encodeBeginProgramDataObservationV1(begin());
  zeroGeneration.fill(0, 2, 10);
  assert.throws(() => decodeBeginProgramDataObservationV1(zeroGeneration), /identity/);

  const wrongAppendStatus = encodeAppendProgramDataObservationChunkV1({
    guard: guard(),
    expectedStatus: ProgramDataObservationStatusV1.Accumulating,
    chunkIndex: 0,
  });
  wrongAppendStatus[61] = ProgramDataObservationStatusV1.Finalized;
  assert.throws(() => decodeAppendProgramDataObservationChunkV1(wrongAppendStatus), /Accumulating/);
});

test("observation builders expose only the Rust-authoritative fixed account vectors", () => {
  const programId = key("program-id");
  const beginAccounts = {
    payer: key("payer"),
    controllerConfig: key("config"),
    protocolGate: key("gate"),
    capacityPolicy: key("policy"),
    subject: key("subject-account"),
    observedProgram: key("observed-program"),
    observedProgramdata: key("observed-programdata"),
    observation: key("observation"),
    upgradeableLoader: key("loader"),
    systemProgram: SystemProgram.programId,
  };
  const beginIx = buildBeginProgramDataObservationV1Instruction(programId, beginAccounts, begin());
  assert.equal(beginIx.keys.length, 10);
  assert.deepEqual(beginIx.keys.map(({ isSigner, isWritable }) => [isSigner, isWritable]), [
    [true, true], [false, false], [false, false], [false, false], [false, false],
    [false, false], [false, false], [false, true], [false, false], [false, false],
  ]);

  const stepAccounts = {
    controllerConfig: beginAccounts.controllerConfig,
    protocolGate: beginAccounts.protocolGate,
    capacityPolicy: beginAccounts.capacityPolicy,
    subject: beginAccounts.subject,
    observedProgram: beginAccounts.observedProgram,
    observedProgramdata: beginAccounts.observedProgramdata,
    observation: beginAccounts.observation,
    upgradeableLoader: beginAccounts.upgradeableLoader,
  };
  const appendIx = buildAppendProgramDataObservationChunkV1Instruction(programId, stepAccounts, {
    guard: guard(), expectedStatus: ProgramDataObservationStatusV1.Accumulating, chunkIndex: 0,
  });
  const verifyIx = buildVerifyObservedArtifactChunkV1Instruction(programId, stepAccounts, {
    guard: guard(), expectedStatus: ProgramDataObservationStatusV1.Accumulating,
    chunkIndex: 0, expectedNextArtifactChunkIndex: 0, expectedTailBytesVerified: 0n, proof,
  });
  const finalizeIx = buildFinalizeProgramDataObservationV1Instruction(programId, stepAccounts, {
    guard: guard(), expectedStatus: ProgramDataObservationStatusV1.ReadyToFinalize,
    expectedNextRawChunkIndex: 1, expectedNextArtifactChunkIndex: 1, expectedTailBytesVerified: 0n,
  });
  for (const ix of [appendIx, verifyIx, finalizeIx]) {
    assert.equal(ix.keys.length, 8);
    assert.deepEqual(ix.keys.map(({ isSigner, isWritable }) => [isSigner, isWritable]), [
      [false, false], [false, false], [false, false], [false, false],
      [false, false], [false, false], [false, true], [false, false],
    ]);
  }
});
