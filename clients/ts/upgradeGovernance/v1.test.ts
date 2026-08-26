import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import {
  PROPOSAL_DIGEST_DOMAIN_V1,
  canonicalCouncilSetHashMaterial,
  canonicalPolicyHashMaterial,
  canonicalProposalDigestMaterial,
  deriveAuthorityPda,
  deriveBufferCheckPda,
  deriveCheckpointPda,
  deriveControllerConfigPda,
  deriveCouncilPda,
  deriveGatePda,
  derivePolicyPda,
  deriveProposalPda,
  governanceCouncilSetHash,
  governancePolicyHash,
  proposalDigest,
  serializeCouncilSeatV1,
  serializeGovernanceCouncilSetV1,
  serializeGovernancePolicyV1,
  validateCouncilSeatV1Bytes,
  validateGovernanceCouncilSetV1Bytes,
  validateGovernancePolicyV1Bytes,
} from "./v1.js";
import {
  syntheticCouncilHashV1,
  syntheticCouncilV1,
  syntheticPolicyHashV1,
  syntheticPolicyV1,
  syntheticProposalDigestInputV1,
} from "./syntheticVector.js";

interface ExpectedPda {
  address: string;
  bump: number;
}

interface Fixture {
  schemaVersion: number;
  accountLengths: Record<string, number>;
  pdaInputs: {
    controllerProgram: string;
    targetProgram: string;
    policyVersion: string;
    councilVersion: string;
    proposalId: string;
  };
  pdas: Record<string, ExpectedPda>;
  policy: {
    materialLength: number;
    materialHex: string;
    sha256Hex: string;
    accountLength: number;
    accountHex: string;
  };
  council: {
    firstSeatHex: string;
    materialLength: number;
    materialHex: string;
    sha256Hex: string;
    accountLength: number;
    accountHex: string;
  };
  proposalInputs: {
    policyHashHex: string;
    councilHashHex: string;
    voteRequirement: number;
    voteProgram: string;
    voteResultPda: string;
  };
  proposalDigest: {
    domainAscii: string;
    materialLength: number;
    preimageLength: number;
    materialHex: string;
    preimageHex: string;
    sha256Hex: string;
  };
}

const fixture = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/upgrade_governance_v1.json", import.meta.url),
    "utf8",
  ),
) as Fixture;

function expectPda(actual: [PublicKey, number], expected: ExpectedPda): void {
  assert.equal(actual[0].toBase58(), expected.address);
  assert.equal(actual[1], expected.bump);
}

test("all Phase 2 PDA derivations match the frozen Rust fixture", () => {
  assert.equal(fixture.schemaVersion, 2);
  const controller = new PublicKey(fixture.pdaInputs.controllerProgram);
  const target = new PublicKey(fixture.pdaInputs.targetProgram);
  const policyVersion = BigInt(fixture.pdaInputs.policyVersion);
  const councilVersion = BigInt(fixture.pdaInputs.councilVersion);
  const proposalId = BigInt(fixture.pdaInputs.proposalId);
  const proposal = deriveProposalPda(controller, target, proposalId)[0];

  expectPda(
    deriveControllerConfigPda(controller, target),
    fixture.pdas.controllerConfig,
  );
  expectPda(deriveAuthorityPda(controller, target), fixture.pdas.authority);
  expectPda(deriveGatePda(controller, target), fixture.pdas.gate);
  expectPda(
    derivePolicyPda(controller, target, policyVersion),
    fixture.pdas.policy,
  );
  expectPda(
    deriveCouncilPda(controller, target, councilVersion),
    fixture.pdas.council,
  );
  expectPda(
    deriveProposalPda(controller, target, proposalId),
    fixture.pdas.proposal,
  );
  expectPda(
    deriveCheckpointPda(controller, proposal, 0),
    fixture.pdas.prestateCheckpoint,
  );
  expectPda(
    deriveCheckpointPda(controller, proposal, 1),
    fixture.pdas.poststateCheckpoint,
  );
  expectPda(
    deriveBufferCheckPda(controller, proposal),
    fixture.pdas.bufferCheck,
  );
});

test("policy and simplified council layouts and hashes match the frozen fixture", () => {
  const policy = syntheticPolicyV1();
  const council = syntheticCouncilV1();
  const seatBytes = serializeCouncilSeatV1(council.seats[0]!);
  const policyBytes = serializeGovernancePolicyV1(policy);
  const councilBytes = serializeGovernanceCouncilSetV1(council);
  const policyMaterial = canonicalPolicyHashMaterial(policy);
  const councilMaterial = canonicalCouncilSetHashMaterial(council);

  assert.equal(seatBytes.length, fixture.accountLengths.councilSeat);
  assert.equal(seatBytes.toString("hex"), fixture.council.firstSeatHex);
  assert.equal(policyBytes.length, fixture.accountLengths.governancePolicy);
  assert.equal(councilBytes.length, fixture.accountLengths.governanceCouncilSet);
  assert.equal(policyMaterial.length, fixture.policy.materialLength);
  assert.equal(policyMaterial.toString("hex"), fixture.policy.materialHex);
  assert.equal(governancePolicyHash(policy).toString("hex"), fixture.policy.sha256Hex);
  assert.equal(policyBytes.toString("hex"), fixture.policy.accountHex);
  assert.equal(councilMaterial.length, fixture.council.materialLength);
  assert.equal(councilMaterial.toString("hex"), fixture.council.materialHex);
  assert.equal(
    governanceCouncilSetHash(council).toString("hex"),
    fixture.council.sha256Hex,
  );
  assert.equal(councilBytes.toString("hex"), fixture.council.accountHex);
  assert.equal(syntheticPolicyHashV1.toString("hex"), fixture.policy.sha256Hex);
  assert.equal(syntheticCouncilHashV1.toString("hex"), fixture.council.sha256Hex);

  validateCouncilSeatV1Bytes(seatBytes);
  validateGovernancePolicyV1Bytes(policyBytes);
  validateGovernanceCouncilSetV1Bytes(councilBytes);
});

test("fixed layout validators reject truncation, trailing, enum, boolean, and reserved drift", () => {
  const policy = serializeGovernancePolicyV1(syntheticPolicyV1());
  const councilValue = syntheticCouncilV1();
  const council = serializeGovernanceCouncilSetV1(councilValue);
  const seat = serializeCouncilSeatV1(councilValue.seats[0]!);

  assert.throws(() => validateCouncilSeatV1Bytes(seat.subarray(0, 95)), /96 bytes/);
  assert.throws(
    () => validateGovernancePolicyV1Bytes(Buffer.concat([policy, Buffer.alloc(1)])),
    /160 bytes/,
  );
  assert.throws(
    () => validateGovernanceCouncilSetV1Bytes(council.subarray(0, 639)),
    /640 bytes/,
  );

  const badSeatBool = Buffer.from(seat);
  badSeatBool[48] = 2;
  assert.throws(() => validateCouncilSeatV1Bytes(badSeatBool), /canonical boolean/);

  const badSeatReserved = Buffer.from(seat);
  badSeatReserved[95] = 1;
  assert.throws(() => validateCouncilSeatV1Bytes(badSeatReserved), /must be zero/);

  const unknownMode = Buffer.from(policy);
  unknownMode[94] = 1;
  assert.throws(() => validateGovernancePolicyV1Bytes(unknownMode), /unknown GovernanceModeV1/);

  const badPolicyBool = Buffer.from(policy);
  badPolicyBool[102] = 2;
  assert.throws(() => validateGovernancePolicyV1Bytes(badPolicyBool), /canonical boolean/);

  const badPolicyReserved = Buffer.from(policy);
  badPolicyReserved[159] = 1;
  assert.throws(() => validateGovernancePolicyV1Bytes(badPolicyReserved), /must be zero/);

  const badCouncilReserved = Buffer.from(council);
  badCouncilReserved[639] = 1;
  assert.throws(() => validateGovernanceCouncilSetV1Bytes(badCouncilReserved), /must be zero/);
});

test("proposal material, preimage, and SHA-256 match the frozen Rust fixture", () => {
  const input = syntheticProposalDigestInputV1();
  const material = canonicalProposalDigestMaterial(input);
  const preimage = Buffer.concat([PROPOSAL_DIGEST_DOMAIN_V1, material]);
  assert.equal(syntheticPolicyHashV1.toString("hex"), fixture.proposalInputs.policyHashHex);
  assert.equal(syntheticCouncilHashV1.toString("hex"), fixture.proposalInputs.councilHashHex);
  assert.equal(input.voteRequirement, fixture.proposalInputs.voteRequirement);
  assert.equal(input.voteProgram.toBase58(), fixture.proposalInputs.voteProgram);
  assert.equal(input.voteResultPda.toBase58(), fixture.proposalInputs.voteResultPda);
  assert.equal(PROPOSAL_DIGEST_DOMAIN_V1.toString("ascii"), fixture.proposalDigest.domainAscii);
  assert.equal(material.length, fixture.proposalDigest.materialLength);
  assert.equal(preimage.length, fixture.proposalDigest.preimageLength);
  assert.equal(material.toString("hex"), fixture.proposalDigest.materialHex);
  assert.equal(preimage.toString("hex"), fixture.proposalDigest.preimageHex);
  assert.equal(proposalDigest(input).toString("hex"), fixture.proposalDigest.sha256Hex);
});

test("optional public keys and numeric bounds reject noncanonical inputs", () => {
  const input = syntheticProposalDigestInputV1();
  input.rollbackProposal = { present: false, value: new PublicKey(Buffer.alloc(32, 1)) };
  assert.throws(() => canonicalProposalDigestMaterial(input), /canonically encoded/);

  const overflow = syntheticProposalDigestInputV1();
  overflow.proposalId = 0x1_0000_0000_0000_0000n;
  assert.throws(() => canonicalProposalDigestMaterial(overflow), /u64 out of range/);
});
