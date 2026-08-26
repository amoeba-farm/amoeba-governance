import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
} from "../upgradeGovernance/v1.js";
import {
  syntheticCouncilHashV1,
  syntheticCouncilV1,
  syntheticKey,
  syntheticPolicyHashV1,
  syntheticPolicyV1,
  syntheticProposalDigestInputV1,
} from "../upgradeGovernance/syntheticVector.js";

const proposal = syntheticProposalDigestInputV1();
const policy = syntheticPolicyV1();
const council = syntheticCouncilV1();
const controller = syntheticKey(1);
const target = syntheticKey(3);
const proposalPda = deriveProposalPda(controller, target, proposal.proposalId)[0];
const pda = (value: ReturnType<typeof deriveProposalPda>) => ({
  address: value[0].toBase58(),
  bump: value[1],
});
const material = canonicalProposalDigestMaterial(proposal);
const preimage = Buffer.concat([PROPOSAL_DIGEST_DOMAIN_V1, material]);
const policyMaterial = canonicalPolicyHashMaterial(policy);
const policyAccount = serializeGovernancePolicyV1(policy);
const councilMaterial = canonicalCouncilSetHashMaterial(council);
const councilAccount = serializeGovernanceCouncilSetV1(council);
const firstSeatAccount = serializeCouncilSeatV1(council.seats[0]!);
const output = {
  schemaVersion: 2,
  note: "Synthetic non-production Phase 2 bootstrap V1 golden vector; the controller program id is not finalized.",
  pdaInputs: {
    controllerProgram: controller.toBase58(),
    targetProgram: target.toBase58(),
    policyVersion: "7",
    councilVersion: "11",
    proposalId: proposal.proposalId.toString(),
  },
  pdas: {
    controllerConfig: pda(deriveControllerConfigPda(controller, target)),
    authority: pda(deriveAuthorityPda(controller, target)),
    gate: pda(deriveGatePda(controller, target)),
    policy: pda(derivePolicyPda(controller, target, 7n)),
    council: pda(deriveCouncilPda(controller, target, 11n)),
    proposal: pda(deriveProposalPda(controller, target, proposal.proposalId)),
    prestateCheckpoint: pda(deriveCheckpointPda(controller, proposalPda, 0)),
    poststateCheckpoint: pda(deriveCheckpointPda(controller, proposalPda, 1)),
    bufferCheck: pda(deriveBufferCheckPda(controller, proposalPda)),
  },
  accountLengths: {
    controllerConfig: 512,
    governancePolicy: policyAccount.length,
    councilSeat: serializeCouncilSeatV1(council.seats[0]!).length,
    governanceCouncilSet: councilAccount.length,
    protocolGate: 192,
    upgradeProposal: 1280,
  },
  policy: {
    materialLength: policyMaterial.length,
    materialHex: policyMaterial.toString("hex"),
    sha256Hex: governancePolicyHash(policy).toString("hex"),
    accountLength: policyAccount.length,
    accountHex: policyAccount.toString("hex"),
  },
  council: {
    firstSeatHex: firstSeatAccount.toString("hex"),
    materialLength: councilMaterial.length,
    materialHex: councilMaterial.toString("hex"),
    sha256Hex: governanceCouncilSetHash(council).toString("hex"),
    accountLength: councilAccount.length,
    accountHex: councilAccount.toString("hex"),
  },
  proposalInputs: {
    policyHashHex: syntheticPolicyHashV1.toString("hex"),
    councilHashHex: syntheticCouncilHashV1.toString("hex"),
    voteRequirement: 0,
    voteProgram: proposal.voteProgram.toBase58(),
    voteResultPda: proposal.voteResultPda.toBase58(),
  },
  proposalDigest: {
    domainAscii: PROPOSAL_DIGEST_DOMAIN_V1.toString("ascii"),
    materialLength: material.length,
    preimageLength: preimage.length,
    materialHex: material.toString("hex"),
    preimageHex: preimage.toString("hex"),
    sha256Hex: proposalDigest(proposal).toString("hex"),
  },
};

const targetPath = fileURLToPath(
  new URL("../../../fixtures/upgrade_governance_v1.json", import.meta.url),
);
const serialized = `${JSON.stringify(output, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(targetPath, "utf8") !== serialized) {
    throw new Error("frozen governance vector is stale; run npm run generate:vectors");
  }
} else {
  writeFileSync(targetPath, serialized, { encoding: "utf8" });
}
