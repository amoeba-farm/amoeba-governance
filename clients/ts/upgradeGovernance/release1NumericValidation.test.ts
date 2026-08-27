import assert from "node:assert/strict";
import test from "node:test";

import {
  PROPOSAL_EXPIRED_TERMINAL_REASON_V1,
  ProposalStateV2,
  validateBufferVerificationV1,
  validateCheckpointAttestationV1,
  validateCouncilRotationProposalV1,
  validateEmergencyFreezeObservationV1,
  validateEmergencyFreezeResolutionV1,
  validateProgramDataFailureObservationV1,
  validateProgramDataVerificationV1,
  validateStateCheckpointV1,
  validateUpgradeProposalV2,
} from "./release1.js";
import {
  syntheticBufferVerificationV1,
  syntheticCheckpointAttestationV1,
  syntheticCouncilRotationProposalV1,
  syntheticEmergencyFreezeObservationV1,
  syntheticEmergencyFreezeResolutionV1,
  syntheticProgramDataFailureObservationV1,
  syntheticProgramDataVerificationV1,
  syntheticStateCheckpointV1,
  syntheticUpgradeProposalV2,
} from "./release1SyntheticVector.js";

test("public Release 1 validators reject non-wire bump and integer values", () => {
  const proposal = syntheticUpgradeProposalV2();
  proposal.bump = -1;
  assert.throws(() => validateUpgradeProposalV2(proposal), /u8/);

  const negativeProposalSlot = syntheticUpgradeProposalV2();
  negativeProposalSlot.firstApprovalSlot = -1n;
  assert.throws(() => validateUpgradeProposalV2(negativeProposalSlot), /u64/);

  const buffer = syntheticBufferVerificationV1();
  buffer.adoptedSlot = -1n;
  assert.throws(() => validateBufferVerificationV1(buffer), /u64/);

  const programdata = syntheticProgramDataVerificationV1();
  programdata.finalizedSlot = -1n;
  assert.throws(() => validateProgramDataVerificationV1(programdata), /u64/);

  const checkpoint = syntheticStateCheckpointV1();
  checkpoint.programOwnedStateCount = -1n;
  assert.throws(() => validateStateCheckpointV1(checkpoint), /u64/);

  const rotation = syntheticCouncilRotationProposalV1();
  rotation.currentCouncilVersion = -1n;
  assert.throws(() => validateCouncilRotationProposalV1(rotation), /u64/);

  const terminalRotation = syntheticCouncilRotationProposalV1();
  terminalRotation.candidateCouncilVersion = 0xffff_ffff_ffff_ffffn;
  assert.throws(
    () => validateCouncilRotationProposalV1(terminalRotation),
    /invalid CouncilRotationProposalV1 commitment/,
  );

  const resolution = syntheticEmergencyFreezeResolutionV1();
  resolution.targetNonce = -1n;
  assert.throws(() => validateEmergencyFreezeResolutionV1(resolution), /u64/);

  const freeze = syntheticEmergencyFreezeObservationV1();
  freeze.bump = 256;
  assert.throws(() => validateEmergencyFreezeObservationV1(freeze), /u8/);

  const failure = syntheticProgramDataFailureObservationV1();
  failure.actualCapacity = -1n;
  assert.throws(() => validateProgramDataFailureObservationV1(failure), /u64/);

  const attestation = syntheticCheckpointAttestationV1();
  attestation.bump = -1;
  assert.throws(() => validateCheckpointAttestationV1(attestation), /u8/);
});

test("public observation validators reject impossible Loader-v3 lengths", () => {
  const resolution = syntheticEmergencyFreezeResolutionV1();
  resolution.observedProgramdataDataLength += 1n;
  assert.throws(
    () => validateEmergencyFreezeResolutionV1(resolution),
    /metadata plus capacity/,
  );

  const freeze = syntheticEmergencyFreezeObservationV1();
  freeze.actualProgramdataDataLength += 1n;
  assert.throws(
    () => validateEmergencyFreezeObservationV1(freeze),
    /metadata plus capacity/,
  );

  const failure = syntheticProgramDataFailureObservationV1();
  failure.actualDataLength += 1n;
  assert.throws(
    () => validateProgramDataFailureObservationV1(failure),
    /metadata plus capacity/,
  );
});

test("proposal validator enforces canonical lifecycle slots, quorums, and reasons", () => {
  const dirtyDraft = syntheticUpgradeProposalV2();
  dirtyDraft.councilApprovalBitset = 1;
  dirtyDraft.councilApprovalCount = 1;
  dirtyDraft.firstApprovalSlot = dirtyDraft.reviewStartSlot;
  assert.throws(
    () => validateUpgradeProposalV2(dirtyDraft),
    /pre-freeze state is not canonical/,
  );

  const partialReview = syntheticUpgradeProposalV2();
  partialReview.state = ProposalStateV2.BufferVerified;
  partialReview.councilApprovalBitset = 1;
  partialReview.councilApprovalCount = 1;
  partialReview.firstApprovalSlot = partialReview.reviewStartSlot;
  assert.doesNotThrow(() => validateUpgradeProposalV2(partialReview));

  const poststate = syntheticUpgradeProposalV2();
  poststate.state = ProposalStateV2.PoststateAccepted;
  poststate.freezeGateEpoch = poststate.creationGateEpoch + 1n;
  poststate.councilApprovalBitset = 0b0_0111;
  poststate.councilApprovalCount = 3;
  poststate.firstApprovalSlot = poststate.reviewStartSlot;
  poststate.councilApprovedSlot = poststate.reviewStartSlot;
  poststate.governanceSatisfiedSlot = poststate.reviewStartSlot + 1n;
  poststate.queuedSlot = poststate.reviewStartSlot + 2n;
  poststate.frozenSlot = poststate.notBeforeSlot;
  poststate.extensionExecutedSlot = poststate.notBeforeSlot + 1n;
  poststate.upgradeExecutedSlot = poststate.notBeforeSlot + 2n;
  poststate.programdataVerifiedSlot = poststate.notBeforeSlot + 3n;
  poststate.poststateAcceptedSlot = poststate.notBeforeSlot + 4n;
  poststate.unfreezeCouncilVersion = poststate.creationCouncilVersion;
  poststate.unfreezeCouncilHash = Buffer.from(poststate.creationCouncilHash);
  poststate.unfreezeApprovalBitset = 1;
  poststate.unfreezeApprovalCount = 1;
  assert.doesNotThrow(() => validateUpgradeProposalV2(poststate));
  poststate.upgradeExecutedSlot = poststate.extensionExecutedSlot;
  assert.throws(
    () => validateUpgradeProposalV2(poststate),
    /upgrade slot is not canonical/,
  );

  const cancelled = syntheticUpgradeProposalV2();
  cancelled.state = ProposalStateV2.Cancelled;
  cancelled.cancellationCouncilVersion = cancelled.creationCouncilVersion;
  cancelled.cancellationCouncilHash = Buffer.from(cancelled.creationCouncilHash);
  cancelled.cancellationApprovalBitset = 0b0_0111;
  cancelled.cancellationApprovalCount = 3;
  cancelled.cancellationReasonCode = 77;
  cancelled.terminalReasonCode = 77;
  cancelled.terminalSlot = cancelled.reviewStartSlot;
  assert.doesNotThrow(() => validateUpgradeProposalV2(cancelled));
  cancelled.terminalReasonCode = 78;
  assert.throws(
    () => validateUpgradeProposalV2(cancelled),
    /cancelled proposal lacks canonical quorum or reason/,
  );

  const expired = syntheticUpgradeProposalV2();
  expired.state = ProposalStateV2.Expired;
  expired.terminalSlot = expired.expirySlot;
  expired.terminalReasonCode = PROPOSAL_EXPIRED_TERMINAL_REASON_V1;
  assert.doesNotThrow(() => validateUpgradeProposalV2(expired));
});
