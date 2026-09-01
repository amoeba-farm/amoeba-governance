import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";

import * as abi from "./release1GovernanceV2.js";
import * as builders from "./release1GovernanceV2Instructions.js";

const SOLANA_TRANSACTION_PACKET_LIMIT = 1_232;

const hash = (label: string): Buffer => createHash("sha256").update(label, "utf8").digest();
const key = (label: string): PublicKey => new PublicKey(hash(`governance-v2-instruction:${label}`));

const accounts = {
  payer: key("payer"),
  initializer: key("initializer"),
  creator: key("creator"),
  controllerProgram: key("controller-program"),
  controllerProgramdata: key("controller-programdata"),
  controllerConfig: key("controller-config"),
  governancePolicy: key("governance-policy"),
  council: key("council"),
  currentCouncil: key("current-council"),
  candidateCouncil: key("candidate-council"),
  protocolGate: key("protocol-gate"),
  capacityPolicy: key("capacity-policy"),
  controllerImmutabilityReceipt: key("controller-immutability-receipt"),
  bridgeObservation: key("bridge-observation"),
  targetProgram: key("target-program"),
  targetProgramdata: key("target-programdata"),
  legacyAuthority: key("legacy-authority"),
  controllerAuthority: key("controller-authority"),
  lifecycleRegistry: key("lifecycle-registry"),
  initialTimingProfile: key("initial-timing-profile"),
  currentTimingProfile: key("current-timing-profile"),
  governingTimingProfile: key("governing-timing-profile"),
  candidateTimingProfile: key("candidate-timing-profile"),
  proposal: key("proposal"),
  targetHandoffReceipt: key("target-handoff-receipt"),
  bootstrapActivationReceipt: key("bootstrap-activation-receipt"),
  currentDeployment: key("current-deployment"),
  upgradeableLoader: key("upgradeable-loader"),
  seatAuthority: key("seat-authority"),
  systemProgram: SystemProgram.programId,
  instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
} as const;

const profile = abi.nominalGovernanceTimingProfileV1({
  bump: abi.deriveGovernanceTimingProfilePdaV1(
    accounts.controllerProgram,
    accounts.targetProgram,
    1n,
  )[1],
  controllerConfig: accounts.controllerConfig,
  targetProgram: accounts.targetProgram,
  creationCouncilVersion: 1n,
  creationSlot: 1_000_000n,
});

const guard: abi.GovernanceActionGuardV2 = {
  proposalId: 9n,
  expectedProposalDigest: hash("proposal-digest"),
  expectedCouncilVersion: 1n,
  expectedTimingProfileVersion: 1n,
  expectedTimingProfileHash: profile.profileHash,
};

const envelope = {
  computeUnitLimit: 1_000_000,
  computeUnitPriceMicroLamports: 1n,
  durableNonceAccount: { present: false, value: PublicKey.default },
  durableNonceAuthority: { present: false, value: PublicKey.default },
};

const values = {
  initialize: {
    expectedInitialTimingProfileVersion: 1n,
    expectedInitialTimingProfileHash: profile.profileHash,
    expectedInitialNextProposalId: 1n,
    expectedInitialRotationNonce: 1n,
  } satisfies abi.InitializeGovernanceLifecycleRegistryV2,
  createProfile: {
    profileVersion: 2n,
    predecessorProfileHash: profile.profileHash,
    emergencyRollback: profile.emergencyRollback,
    routine: profile.routine,
    major: profile.major,
    constitutional: profile.constitutional,
  } satisfies abi.CreateGovernanceTimingProfileV1,
  createPolicy: {
    expectedProposalId: 1n,
    expectedCurrentTimingProfileVersion: 1n,
    expectedCurrentTimingProfileHash: profile.profileHash,
    candidateTimingProfileVersion: 2n,
    candidateTimingProfileHash: hash("candidate-profile"),
    expectedCouncilVersion: 1n,
    expectedCouncilHash: hash("council-hash"),
  } satisfies abi.CreateTimingPolicyChangeProposalV1,
  createRotation: {
    expectedProposalId: 2n,
    expectedCurrentCouncilVersion: 1n,
    expectedCurrentCouncilHash: hash("current-council-hash"),
    candidateCouncilVersion: 2n,
    candidateCouncilHash: hash("candidate-council-hash"),
    expectedRotationNonce: 1n,
    expectedTimingProfileVersion: 1n,
    expectedTimingProfileHash: profile.profileHash,
  } satisfies abi.CreateCouncilRotationProposalV2,
  createHandoff: {
    expectedProposalId: 3n,
    expectedGateEpoch: 1n,
    expectedTargetNonce: 1n,
    expectedCouncilVersion: 1n,
    expectedTimingProfileVersion: 1n,
    expectedTimingProfileHash: profile.profileHash,
    bridgeSourceCommitment: hash("bridge-source"),
    bridgeBuildInputsCommitment: hash("bridge-build-inputs"),
    bridgePackageCommitment: hash("bridge-package"),
    bridgeReleaseManifestCommitment: hash("bridge-release-manifest"),
  } satisfies abi.CreateTargetAuthorityHandoffProposalV2,
  executeHandoff: {
    guard,
    expectedBridgeObservationDigest: hash("bridge-observation-digest"),
    expectedGateEpoch: 1n,
    expectedTargetNonce: 1n,
    envelope,
  } satisfies abi.ExecuteTargetAuthorityHandoffProposalV2,
  createActivation: {
    expectedProposalId: 4n,
    expectedControllerImmutabilityDigest: hash("immutability-digest"),
    expectedHandoffReceiptDigest: hash("handoff-receipt-digest"),
    expectedBridgeObservationDigest: hash("activation-observation-digest"),
    expectedGateEpoch: 1n,
    expectedTargetNonce: 1n,
    expectedCouncilVersion: 1n,
    expectedTimingProfileVersion: 1n,
    expectedTimingProfileHash: profile.profileHash,
  } satisfies abi.CreateBootstrapActivationProposalV2,
  executeActivation: {
    guard,
    expectedBridgeObservationDigest: hash("activation-observation-digest"),
    expectedGateEpoch: 1n,
    expectedTargetNonce: 1n,
    expectedDeploymentPlanDigest: hash("deployment-plan-digest"),
    expectedReceiptPlanDigest: hash("receipt-plan-digest"),
    envelope,
  } satisfies abi.ExecuteBootstrapActivationProposalV2,
} as const;

interface ExpectedMeta {
  readonly pubkey: PublicKey;
  readonly isSigner: boolean;
  readonly isWritable: boolean;
}

const er = (pubkey: PublicKey): ExpectedMeta => ({ pubkey, isSigner: false, isWritable: false });
const ew = (pubkey: PublicKey): ExpectedMeta => ({ pubkey, isSigner: false, isWritable: true });
const es = (pubkey: PublicKey): ExpectedMeta => ({ pubkey, isSigner: true, isWritable: false });
const ews = (pubkey: PublicKey): ExpectedMeta => ({ pubkey, isSigner: true, isWritable: true });

const timingAction = [
  er(accounts.controllerConfig), er(accounts.governancePolicy), er(accounts.council),
  er(accounts.protocolGate), er(accounts.lifecycleRegistry), er(accounts.governingTimingProfile),
  er(accounts.candidateTimingProfile), ew(accounts.proposal),
] as const;

const rotationAction = [
  er(accounts.controllerConfig), er(accounts.governancePolicy), er(accounts.currentCouncil),
  er(accounts.candidateCouncil), er(accounts.protocolGate), er(accounts.lifecycleRegistry),
  er(accounts.governingTimingProfile), ew(accounts.proposal),
] as const;

const handoffEvidence = [
  er(accounts.controllerProgram), er(accounts.controllerProgramdata), er(accounts.controllerConfig),
  er(accounts.governancePolicy), er(accounts.council), er(accounts.protocolGate),
  er(accounts.capacityPolicy), er(accounts.controllerImmutabilityReceipt), er(accounts.bridgeObservation),
  er(accounts.targetProgram), er(accounts.targetProgramdata), er(accounts.legacyAuthority),
  er(accounts.controllerAuthority), er(accounts.lifecycleRegistry), er(accounts.governingTimingProfile),
  ew(accounts.proposal), er(accounts.upgradeableLoader),
] as const;

const activationEvidence = [
  er(accounts.controllerProgram), er(accounts.controllerProgramdata), er(accounts.controllerConfig),
  er(accounts.governancePolicy), er(accounts.council), er(accounts.protocolGate),
  er(accounts.capacityPolicy), er(accounts.controllerImmutabilityReceipt), er(accounts.targetHandoffReceipt),
  er(accounts.bridgeObservation), er(accounts.targetProgram), er(accounts.targetProgramdata),
  er(accounts.controllerAuthority), er(accounts.lifecycleRegistry), er(accounts.governingTimingProfile),
  ew(accounts.proposal), er(accounts.upgradeableLoader),
] as const;

interface InstructionCase {
  readonly tag: number;
  readonly build: () => TransactionInstruction;
  readonly encode: () => Buffer;
  readonly expected: readonly ExpectedMeta[];
}

const cases: readonly InstructionCase[] = [
  {
    tag: 82,
    build: () => builders.buildInitializeGovernanceLifecycleRegistryV2Instruction(accounts.controllerProgram, accounts, values.initialize),
    encode: () => abi.encodeInitializeGovernanceLifecycleRegistryV2(values.initialize),
    expected: [ews(accounts.payer), es(accounts.initializer), er(accounts.controllerProgram), er(accounts.controllerProgramdata), er(accounts.controllerConfig), er(accounts.governancePolicy), er(accounts.council), er(accounts.protocolGate), ew(accounts.lifecycleRegistry), ew(accounts.initialTimingProfile), er(accounts.systemProgram)],
  },
  {
    tag: 83,
    build: () => builders.buildCreateGovernanceTimingProfileV1Instruction(accounts.controllerProgram, accounts, values.createProfile),
    encode: () => abi.encodeCreateGovernanceTimingProfileV1(values.createProfile),
    expected: [ews(accounts.payer), es(accounts.creator), er(accounts.controllerConfig), er(accounts.governancePolicy), er(accounts.council), er(accounts.protocolGate), ew(accounts.lifecycleRegistry), er(accounts.currentTimingProfile), ew(accounts.candidateTimingProfile), er(accounts.systemProgram)],
  },
  {
    tag: 84,
    build: () => builders.buildCreateTimingPolicyChangeProposalV1Instruction(accounts.controllerProgram, accounts, values.createPolicy),
    encode: () => abi.encodeCreateTimingPolicyChangeProposalV1(values.createPolicy),
    expected: [ews(accounts.payer), es(accounts.creator), er(accounts.controllerConfig), er(accounts.governancePolicy), er(accounts.council), er(accounts.protocolGate), ew(accounts.lifecycleRegistry), er(accounts.governingTimingProfile), er(accounts.candidateTimingProfile), ew(accounts.proposal), er(accounts.systemProgram)],
  },
  { tag: 85, build: () => builders.buildApproveTimingPolicyChangeProposalV1Instruction(accounts.controllerProgram, accounts, { guard }), encode: () => abi.encodeApproveTimingPolicyChangeProposalV1({ guard }), expected: [...timingAction, es(accounts.seatAuthority)] },
  { tag: 86, build: () => builders.buildCancelTimingPolicyChangeProposalV1Instruction(accounts.controllerProgram, accounts, { guard, cancellationReasonCode: 1 }), encode: () => abi.encodeCancelTimingPolicyChangeProposalV1({ guard, cancellationReasonCode: 1 }), expected: [...timingAction, es(accounts.seatAuthority)] },
  { tag: 87, build: () => builders.buildExpireTimingPolicyChangeProposalV1Instruction(accounts.controllerProgram, accounts, { guard }), encode: () => abi.encodeExpireTimingPolicyChangeProposalV1({ guard }), expected: timingAction },
  { tag: 88, build: () => builders.buildQueueTimingPolicyChangeProposalV1Instruction(accounts.controllerProgram, accounts, { guard }), encode: () => abi.encodeQueueTimingPolicyChangeProposalV1({ guard }), expected: timingAction },
  {
    tag: 89,
    build: () => builders.buildExecuteTimingPolicyChangeProposalV1Instruction(accounts.controllerProgram, accounts, { guard }),
    encode: () => abi.encodeExecuteTimingPolicyChangeProposalV1({ guard }),
    expected: [er(accounts.controllerConfig), er(accounts.governancePolicy), er(accounts.council), er(accounts.protocolGate), ew(accounts.lifecycleRegistry), er(accounts.governingTimingProfile), er(accounts.candidateTimingProfile), ew(accounts.proposal)],
  },
  {
    tag: 90,
    build: () => builders.buildCreateCouncilRotationProposalV2Instruction(accounts.controllerProgram, accounts, values.createRotation),
    encode: () => abi.encodeCreateCouncilRotationProposalV2(values.createRotation),
    expected: [ews(accounts.payer), es(accounts.creator), er(accounts.controllerConfig), er(accounts.governancePolicy), er(accounts.currentCouncil), er(accounts.candidateCouncil), er(accounts.protocolGate), ew(accounts.lifecycleRegistry), er(accounts.governingTimingProfile), ew(accounts.proposal), er(accounts.systemProgram)],
  },
  { tag: 91, build: () => builders.buildApproveCouncilRotationProposalV2Instruction(accounts.controllerProgram, accounts, { guard }), encode: () => abi.encodeApproveCouncilRotationProposalV2({ guard }), expected: [...rotationAction, es(accounts.seatAuthority)] },
  { tag: 92, build: () => builders.buildCancelCouncilRotationProposalV2Instruction(accounts.controllerProgram, accounts, { guard, cancellationReasonCode: 2 }), encode: () => abi.encodeCancelCouncilRotationProposalV2({ guard, cancellationReasonCode: 2 }), expected: [...rotationAction, es(accounts.seatAuthority)] },
  {
    tag: 93,
    build: () => builders.buildExpireCouncilRotationProposalV2Instruction(accounts.controllerProgram, accounts, { guard }),
    encode: () => abi.encodeExpireCouncilRotationProposalV2({ guard }),
    expected: [er(accounts.controllerConfig), er(accounts.governancePolicy), er(accounts.currentCouncil), er(accounts.protocolGate), er(accounts.lifecycleRegistry), er(accounts.governingTimingProfile), ew(accounts.proposal)],
  },
  { tag: 94, build: () => builders.buildQueueCouncilRotationProposalV2Instruction(accounts.controllerProgram, accounts, { guard }), encode: () => abi.encodeQueueCouncilRotationProposalV2({ guard }), expected: rotationAction },
  {
    tag: 95,
    build: () => builders.buildExecuteCouncilRotationProposalV2Instruction(accounts.controllerProgram, accounts, { guard }),
    encode: () => abi.encodeExecuteCouncilRotationProposalV2({ guard }),
    expected: [ew(accounts.controllerConfig), er(accounts.governancePolicy), er(accounts.currentCouncil), er(accounts.candidateCouncil), er(accounts.protocolGate), ew(accounts.lifecycleRegistry), er(accounts.governingTimingProfile), ew(accounts.proposal)],
  },
  {
    tag: 96,
    build: () => builders.buildCreateTargetAuthorityHandoffProposalV2Instruction(accounts.controllerProgram, accounts, values.createHandoff),
    encode: () => abi.encodeCreateTargetAuthorityHandoffProposalV2(values.createHandoff),
    expected: [ews(accounts.payer), es(accounts.creator), er(accounts.controllerProgram), er(accounts.controllerProgramdata), er(accounts.controllerConfig), er(accounts.governancePolicy), er(accounts.council), er(accounts.protocolGate), er(accounts.capacityPolicy), er(accounts.controllerImmutabilityReceipt), er(accounts.bridgeObservation), er(accounts.targetProgram), er(accounts.targetProgramdata), er(accounts.legacyAuthority), er(accounts.controllerAuthority), ew(accounts.lifecycleRegistry), er(accounts.governingTimingProfile), ew(accounts.proposal), er(accounts.upgradeableLoader), er(accounts.systemProgram)],
  },
  { tag: 97, build: () => builders.buildApproveTargetAuthorityHandoffProposalV2Instruction(accounts.controllerProgram, accounts, { guard }), encode: () => abi.encodeApproveTargetAuthorityHandoffProposalV2({ guard }), expected: [...handoffEvidence, es(accounts.seatAuthority)] },
  {
    tag: 98,
    build: () => builders.buildCancelTargetAuthorityHandoffProposalV2Instruction(accounts.controllerProgram, accounts, { guard, cancellationReasonCode: 3 }),
    encode: () => abi.encodeCancelTargetAuthorityHandoffProposalV2({ guard, cancellationReasonCode: 3 }),
    expected: [er(accounts.controllerConfig), er(accounts.governancePolicy), er(accounts.council), er(accounts.protocolGate), er(accounts.lifecycleRegistry), er(accounts.governingTimingProfile), ew(accounts.proposal), es(accounts.seatAuthority)],
  },
  {
    tag: 99,
    build: () => builders.buildExpireTargetAuthorityHandoffProposalV2Instruction(accounts.controllerProgram, accounts, { guard }),
    encode: () => abi.encodeExpireTargetAuthorityHandoffProposalV2({ guard }),
    expected: [er(accounts.controllerConfig), er(accounts.lifecycleRegistry), er(accounts.governingTimingProfile), ew(accounts.proposal)],
  },
  { tag: 100, build: () => builders.buildQueueTargetAuthorityHandoffProposalV2Instruction(accounts.controllerProgram, accounts, { guard }), encode: () => abi.encodeQueueTargetAuthorityHandoffProposalV2({ guard }), expected: handoffEvidence },
  {
    tag: 101,
    build: () => builders.buildExecuteTargetAuthorityHandoffProposalV2Instruction(accounts.controllerProgram, accounts, values.executeHandoff),
    encode: () => abi.encodeExecuteTargetAuthorityHandoffProposalV2(values.executeHandoff),
    expected: [ews(accounts.payer), er(accounts.controllerProgram), er(accounts.controllerProgramdata), er(accounts.controllerConfig), er(accounts.governancePolicy), er(accounts.council), er(accounts.protocolGate), er(accounts.capacityPolicy), er(accounts.controllerImmutabilityReceipt), er(accounts.lifecycleRegistry), er(accounts.governingTimingProfile), ew(accounts.proposal), er(accounts.bridgeObservation), er(accounts.targetProgram), ew(accounts.targetProgramdata), es(accounts.legacyAuthority), er(accounts.controllerAuthority), er(accounts.upgradeableLoader), ew(accounts.targetHandoffReceipt), er(accounts.systemProgram), er(accounts.instructionsSysvar)],
  },
  {
    tag: 102,
    build: () => builders.buildCreateBootstrapActivationProposalV2Instruction(accounts.controllerProgram, accounts, values.createActivation),
    encode: () => abi.encodeCreateBootstrapActivationProposalV2(values.createActivation),
    expected: [ews(accounts.payer), es(accounts.creator), er(accounts.controllerProgram), er(accounts.controllerProgramdata), er(accounts.controllerConfig), er(accounts.governancePolicy), er(accounts.council), er(accounts.protocolGate), er(accounts.capacityPolicy), er(accounts.controllerImmutabilityReceipt), er(accounts.targetHandoffReceipt), er(accounts.bridgeObservation), er(accounts.targetProgram), er(accounts.targetProgramdata), er(accounts.controllerAuthority), ew(accounts.lifecycleRegistry), er(accounts.governingTimingProfile), ew(accounts.proposal), er(accounts.upgradeableLoader), er(accounts.systemProgram)],
  },
  { tag: 103, build: () => builders.buildApproveBootstrapActivationProposalV2Instruction(accounts.controllerProgram, accounts, { guard }), encode: () => abi.encodeApproveBootstrapActivationProposalV2({ guard }), expected: [...activationEvidence, es(accounts.seatAuthority)] },
  {
    tag: 104,
    build: () => builders.buildCancelBootstrapActivationProposalV2Instruction(accounts.controllerProgram, accounts, { guard, cancellationReasonCode: 4 }),
    encode: () => abi.encodeCancelBootstrapActivationProposalV2({ guard, cancellationReasonCode: 4 }),
    expected: [er(accounts.controllerConfig), er(accounts.governancePolicy), er(accounts.council), er(accounts.protocolGate), er(accounts.lifecycleRegistry), er(accounts.governingTimingProfile), ew(accounts.proposal), es(accounts.seatAuthority)],
  },
  {
    tag: 105,
    build: () => builders.buildExpireBootstrapActivationProposalV2Instruction(accounts.controllerProgram, accounts, { guard }),
    encode: () => abi.encodeExpireBootstrapActivationProposalV2({ guard }),
    expected: [er(accounts.controllerConfig), er(accounts.lifecycleRegistry), er(accounts.governingTimingProfile), ew(accounts.proposal)],
  },
  { tag: 106, build: () => builders.buildQueueBootstrapActivationProposalV2Instruction(accounts.controllerProgram, accounts, { guard }), encode: () => abi.encodeQueueBootstrapActivationProposalV2({ guard }), expected: activationEvidence },
  {
    tag: 107,
    build: () => builders.buildExecuteBootstrapActivationProposalV2Instruction(accounts.controllerProgram, accounts, values.executeActivation),
    encode: () => abi.encodeExecuteBootstrapActivationProposalV2(values.executeActivation),
    expected: [ews(accounts.payer), er(accounts.controllerProgram), er(accounts.controllerProgramdata), er(accounts.controllerConfig), er(accounts.governancePolicy), er(accounts.council), ew(accounts.protocolGate), er(accounts.capacityPolicy), er(accounts.controllerImmutabilityReceipt), er(accounts.targetHandoffReceipt), er(accounts.lifecycleRegistry), er(accounts.governingTimingProfile), ew(accounts.proposal), er(accounts.bridgeObservation), er(accounts.targetProgram), er(accounts.targetProgramdata), er(accounts.controllerAuthority), er(accounts.upgradeableLoader), ew(accounts.bootstrapActivationReceipt), ew(accounts.currentDeployment), er(accounts.systemProgram), er(accounts.instructionsSysvar)],
  },
];

test("governance-liveness V2 builders cover exact tags, data, account order, and modes", () => {
  assert.deepEqual(cases.map((entry) => entry.tag), Array.from({ length: 26 }, (_, index) => 82 + index));
  for (const entry of cases) {
    const instruction = entry.build();
    assert.ok(instruction.programId.equals(accounts.controllerProgram), `tag ${entry.tag} program`);
    assert.deepEqual(instruction.data, entry.encode(), `tag ${entry.tag} data`);
    assert.equal(instruction.data[0], entry.tag, `tag ${entry.tag} byte`);
    assert.deepEqual(
      instruction.keys.map((meta) => ({
        pubkey: meta.pubkey.toBase58(),
        isSigner: meta.isSigner,
        isWritable: meta.isWritable,
      })),
      entry.expected.map((meta) => ({
        pubkey: meta.pubkey.toBase58(),
        isSigner: meta.isSigner,
        isWritable: meta.isWritable,
      })),
      `tag ${entry.tag} accounts`,
    );
  }
});

function packetBytes(instruction: TransactionInstruction, tag: number): number {
  const uniqueLookupKeys = new Map<string, PublicKey>();
  for (const meta of instruction.keys) {
    if (!meta.isSigner) uniqueLookupKeys.set(meta.pubkey.toBase58(), meta.pubkey);
  }
  const lookup = new AddressLookupTableAccount({
    key: key(`lookup-table-${tag}`),
    state: {
      deactivationSlot: 0xffff_ffff_ffff_ffffn,
      lastExtendedSlot: 900,
      lastExtendedSlotStartIndex: 0,
      authority: key(`lookup-authority-${tag}`),
      addresses: [...uniqueLookupKeys.values()],
    },
  });
  const message = new TransactionMessage({
    payerKey: accounts.payer,
    recentBlockhash: key(`recent-blockhash-${tag}`).toBase58(),
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: envelope.computeUnitLimit }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: envelope.computeUnitPriceMicroLamports }),
      instruction,
    ],
  }).compileToV0Message([lookup]);
  return new VersionedTransaction(message).serialize().length;
}

test("all V2 handoff and activation instructions fit the 1,232-byte packet limit with ALT planning", () => {
  for (const entry of cases.filter(({ tag }) => tag >= 96)) {
    const bytes = packetBytes(entry.build(), entry.tag);
    assert.ok(
      bytes <= SOLANA_TRANSACTION_PACKET_LIMIT,
      `tag ${entry.tag} packet is ${bytes} bytes`,
    );
  }
});

test("controller-program-bearing V2 builders reject a mismatched outer program", () => {
  assert.throws(
    () => builders.buildCreateTargetAuthorityHandoffProposalV2Instruction(
      key("wrong-controller"),
      accounts,
      values.createHandoff,
    ),
    /controllerProgram must equal programId/,
  );
});
