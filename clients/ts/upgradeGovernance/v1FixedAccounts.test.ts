import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import { proposalDigest } from "./v1.js";
import { syntheticCouncilV1, syntheticKey, syntheticPolicyV1, syntheticProposalDigestInputV1 } from "./syntheticVector.js";
import * as fixed from "./v1FixedAccounts.js";

test("all retained V1 fixed account codecs roundtrip without repurposing reserved bytes", () => {
  const policy = syntheticPolicyV1();
  assert.deepEqual(fixed.deserializeGovernancePolicyFixedV1(fixed.serializeGovernancePolicyFixedV1(policy)), policy);
  const council = syntheticCouncilV1();
  assert.deepEqual(fixed.deserializeGovernanceCouncilSetFixedV1(fixed.serializeGovernanceCouncilSetFixedV1(council)), council);

  const config: fixed.ControllerConfigV1 = {
    discriminator: fixed.CONTROLLER_CONFIG_V1_DISCRIMINATOR, version: 1, bump: 200, initialized: true, clusterDomain: Buffer.alloc(32, 1),
    targetProgram: syntheticKey(3), targetProgramdata: syntheticKey(4), upgradeableLoader: syntheticKey(5), authorityPda: syntheticKey(6), gatePda: syntheticKey(7), canonicalSpillTreasury: syntheticKey(8),
    currentCouncilVersion: 11n, currentPolicyVersion: 7n, nextProposalId: 1n, targetNonce: 1n, guardian: syntheticKey(9),
    voteProgram: PublicKey.default, voteProgramdata: PublicKey.default, voteConfig: PublicKey.default, voteMint: PublicKey.default, tokenGovernanceEnabled: false,
    routineDelaySlots: 10n, majorDelaySlots: 20n, rollbackDelaySlots: 5n, terminalDelaySlots: 30n, voteReviewSlots: 4n, proposalExpirySlots: 40n, policyFlags: 0n, reserved: Buffer.alloc(28),
  };
  assert.deepEqual(fixed.deserializeControllerConfigV1(fixed.serializeControllerConfigV1(config)), config);

  const digestInput = syntheticProposalDigestInputV1();
  const proposal: fixed.UpgradeProposalV1 = {
    discriminator: fixed.UPGRADE_PROPOSAL_V1_DISCRIMINATOR, accountVersion: 1, bump: 201, initialized: true,
    proposalId: digestInput.proposalId, targetNonce: digestInput.targetNonce, proposalClass: digestInput.proposalClass, state: 0,
    clusterDomain: digestInput.clusterDomain, controllerProgram: digestInput.controllerProgram, controllerConfig: digestInput.controllerConfig, protocolGate: digestInput.protocolGate,
    policyVersion: digestInput.policyVersion, policyHash: digestInput.policyHash, councilVersion: digestInput.councilVersion, councilHash: digestInput.councilHash,
    creationGateEpoch: digestInput.creationGateEpoch, freezeGateEpoch: digestInput.freezeGateEpoch, targetProgram: digestInput.targetProgram, targetProgramdata: digestInput.targetProgramdata,
    upgradeableLoader: digestInput.upgradeableLoader, authorityPda: digestInput.authorityPda, canonicalSpillTreasury: digestInput.canonicalSpillTreasury,
    bufferPubkey: digestInput.bufferPubkey, bufferLoaderOwner: digestInput.bufferLoaderOwner, bufferAuthority: digestInput.bufferAuthority,
    artifactLength: digestInput.artifactLength, artifactSha256: digestInput.artifactSha256, sourceCommitHash: digestInput.sourceCommitHash, sourceTreeHash: digestInput.sourceTreeHash,
    buildInputInventoryHash: digestInput.buildInputInventoryHash, reproducibleBuildReceiptHash: digestInput.reproducibleBuildReceiptHash, packageReceiptHash: digestInput.packageReceiptHash,
    releaseIntentHash: digestInput.releaseIntentHash, currentDeployedPayloadHash: digestInput.currentDeployedPayloadHash, currentRawProgramdataHash: digestInput.currentRawProgramdataHash,
    deployedSlot: digestInput.deployedSlot, currentCapacity: digestInput.currentCapacity, extensionDelta: digestInput.extensionDelta, expectedPostCapacity: digestInput.expectedPostCapacity,
    prestateCheckpoint: digestInput.prestateCheckpoint, requiredPoststateCheckpoint: digestInput.requiredPoststateCheckpoint, rollbackProposal: digestInput.rollbackProposal,
    rollbackBuffer: digestInput.rollbackBuffer, rollbackArtifactHash: digestInput.rollbackArtifactHash, voteRequirement: digestInput.voteRequirement, voteProgram: digestInput.voteProgram,
    voteResultPda: digestInput.voteResultPda, reviewStartSlot: digestInput.reviewStartSlot, reviewEndSlot: digestInput.reviewEndSlot, notBeforeSlot: digestInput.notBeforeSlot, expirySlot: digestInput.expirySlot,
    councilApprovalBitset: 0, councilApprovalCount: 0, poststateApprovalBitset: 0, poststateApprovalCount: 0, unfreezeApprovalBitset: 0, unfreezeApprovalCount: 0,
    proposalDigest: proposalDigest(digestInput), cancellationReasonCode: 0, terminalReasonCode: 0, reserved: Buffer.alloc(142),
  };
  assert.deepEqual(fixed.deserializeUpgradeProposalFixedV1(fixed.serializeUpgradeProposalFixedV1(proposal)), proposal);
});

test("V1 fixed decoders reject unknown versions, booleans, token defaults, and reserved drift", () => {
  const policy = fixed.serializeGovernancePolicyFixedV1(syntheticPolicyV1());
  for (const [offset, value] of [[8, 2], [10, 2], [139, 1]] as const) {
    const changed = Buffer.from(policy); changed[offset] = value;
    assert.throws(() => fixed.deserializeGovernancePolicyFixedV1(changed));
  }
  const config: fixed.ControllerConfigV1 = {
    discriminator: fixed.CONTROLLER_CONFIG_V1_DISCRIMINATOR, version: 1, bump: 1, initialized: true, clusterDomain: Buffer.alloc(32, 1),
    targetProgram: syntheticKey(1), targetProgramdata: syntheticKey(2), upgradeableLoader: syntheticKey(3), authorityPda: syntheticKey(4), gatePda: syntheticKey(5), canonicalSpillTreasury: syntheticKey(6),
    currentCouncilVersion: 1n, currentPolicyVersion: 1n, nextProposalId: 1n, targetNonce: 1n, guardian: syntheticKey(7), voteProgram: PublicKey.default,
    voteProgramdata: PublicKey.default, voteConfig: PublicKey.default, voteMint: PublicKey.default, tokenGovernanceEnabled: false, routineDelaySlots: 1n, majorDelaySlots: 2n,
    rollbackDelaySlots: 1n, terminalDelaySlots: 3n, voteReviewSlots: 1n, proposalExpirySlots: 4n, policyFlags: 0n, reserved: Buffer.alloc(28),
  };
  assert.throws(() => fixed.serializeControllerConfigV1({ ...config, tokenGovernanceEnabled: true }));
  assert.throws(() => fixed.serializeControllerConfigV1({ ...config, voteProgram: syntheticKey(8) }));
});
