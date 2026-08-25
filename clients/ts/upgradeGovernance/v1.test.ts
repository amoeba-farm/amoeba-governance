import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import {
  PROPOSAL_DIGEST_DOMAIN_V1,
  canonicalProposalDigestMaterial,
  deriveAuthorityPda,
  deriveBufferCheckPda,
  deriveCheckpointPda,
  deriveControllerConfigPda,
  deriveCouncilPda,
  deriveGatePda,
  derivePolicyPda,
  deriveProposalPda,
  proposalDigest,
} from "./v1.js";
import {
  syntheticPolicyHashV1,
  syntheticProposalDigestInputV1,
} from "./syntheticVector.js";

interface ExpectedPda {
  address: string;
  bump: number;
}

interface Fixture {
  schemaVersion: number;
  pdaInputs: {
    controllerProgram: string;
    targetProgram: string;
    policyVersion: string;
    councilVersion: string;
    proposalId: string;
  };
  pdas: Record<string, ExpectedPda>;
  proposalInputs: { policyHashHex: string };
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

test("all Phase 1 PDA derivations match the frozen Rust fixture", () => {
  assert.equal(fixture.schemaVersion, 1);
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

test("proposal material, preimage, and SHA-256 match the frozen Rust fixture", () => {
  const input = syntheticProposalDigestInputV1();
  const material = canonicalProposalDigestMaterial(input);
  const preimage = Buffer.concat([PROPOSAL_DIGEST_DOMAIN_V1, material]);
  assert.equal(syntheticPolicyHashV1.toString("hex"), fixture.proposalInputs.policyHashHex);
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
