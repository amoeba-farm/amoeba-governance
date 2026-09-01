import type { PublicKey, TransactionInstruction } from "@solana/web3.js";

import { fixedInstruction, ro, rs, rw, ws } from "./release1FixedWire.js";
import * as abi from "./release1GovernanceV2.js";

/**
 * TransactionInstruction builders for the additive governance-liveness V2
 * dispatcher surface. Account order and signer/writable privileges mirror the
 * Rust processors for tags 82 through 107 exactly.
 */

function controllerInstruction(
  programId: PublicKey,
  controllerProgram: PublicKey,
  keys: Parameters<typeof fixedInstruction>[1],
  data: Buffer,
): TransactionInstruction {
  if (!programId.equals(controllerProgram)) {
    throw new Error("controllerProgram must equal programId");
  }
  return fixedInstruction(programId, keys, data);
}

export interface InitializeGovernanceLifecycleRegistryV2Accounts {
  payer: PublicKey;
  initializer: PublicKey;
  controllerProgram: PublicKey;
  controllerProgramdata: PublicKey;
  controllerConfig: PublicKey;
  governancePolicy: PublicKey;
  council: PublicKey;
  protocolGate: PublicKey;
  lifecycleRegistry: PublicKey;
  initialTimingProfile: PublicKey;
  systemProgram: PublicKey;
}

export interface CreateGovernanceTimingProfileV1Accounts {
  payer: PublicKey;
  creator: PublicKey;
  controllerConfig: PublicKey;
  governancePolicy: PublicKey;
  council: PublicKey;
  protocolGate: PublicKey;
  lifecycleRegistry: PublicKey;
  currentTimingProfile: PublicKey;
  candidateTimingProfile: PublicKey;
  systemProgram: PublicKey;
}

export interface CreateTimingPolicyChangeProposalV1Accounts {
  payer: PublicKey;
  creator: PublicKey;
  controllerConfig: PublicKey;
  governancePolicy: PublicKey;
  council: PublicKey;
  protocolGate: PublicKey;
  lifecycleRegistry: PublicKey;
  governingTimingProfile: PublicKey;
  candidateTimingProfile: PublicKey;
  proposal: PublicKey;
  systemProgram: PublicKey;
}

export interface TimingPolicyChangeActionV1Accounts {
  controllerConfig: PublicKey;
  governancePolicy: PublicKey;
  council: PublicKey;
  protocolGate: PublicKey;
  lifecycleRegistry: PublicKey;
  governingTimingProfile: PublicKey;
  candidateTimingProfile: PublicKey;
  proposal: PublicKey;
}

export interface TimingPolicyChangeSeatActionV1Accounts extends TimingPolicyChangeActionV1Accounts {
  seatAuthority: PublicKey;
}

export type ApproveTimingPolicyChangeProposalV1Accounts = TimingPolicyChangeSeatActionV1Accounts;
export type CancelTimingPolicyChangeProposalV1Accounts = TimingPolicyChangeSeatActionV1Accounts;
export type ExpireTimingPolicyChangeProposalV1Accounts = TimingPolicyChangeActionV1Accounts;
export type QueueTimingPolicyChangeProposalV1Accounts = TimingPolicyChangeActionV1Accounts;
export type ExecuteTimingPolicyChangeProposalV1Accounts = TimingPolicyChangeActionV1Accounts;

export interface CreateCouncilRotationProposalV2Accounts {
  payer: PublicKey;
  creator: PublicKey;
  controllerConfig: PublicKey;
  governancePolicy: PublicKey;
  currentCouncil: PublicKey;
  candidateCouncil: PublicKey;
  protocolGate: PublicKey;
  lifecycleRegistry: PublicKey;
  governingTimingProfile: PublicKey;
  proposal: PublicKey;
  systemProgram: PublicKey;
}

export interface CouncilRotationActionV2Accounts {
  controllerConfig: PublicKey;
  governancePolicy: PublicKey;
  currentCouncil: PublicKey;
  candidateCouncil: PublicKey;
  protocolGate: PublicKey;
  lifecycleRegistry: PublicKey;
  governingTimingProfile: PublicKey;
  proposal: PublicKey;
}

export interface CouncilRotationSeatActionV2Accounts extends CouncilRotationActionV2Accounts {
  seatAuthority: PublicKey;
}

export interface ExpireCouncilRotationProposalV2Accounts {
  controllerConfig: PublicKey;
  governancePolicy: PublicKey;
  currentCouncil: PublicKey;
  protocolGate: PublicKey;
  lifecycleRegistry: PublicKey;
  governingTimingProfile: PublicKey;
  proposal: PublicKey;
}

export type ApproveCouncilRotationProposalV2Accounts = CouncilRotationSeatActionV2Accounts;
export type CancelCouncilRotationProposalV2Accounts = CouncilRotationSeatActionV2Accounts;
export type QueueCouncilRotationProposalV2Accounts = CouncilRotationActionV2Accounts;
export type ExecuteCouncilRotationProposalV2Accounts = CouncilRotationActionV2Accounts;

export interface CreateTargetAuthorityHandoffProposalV2Accounts {
  payer: PublicKey;
  creator: PublicKey;
  controllerProgram: PublicKey;
  controllerProgramdata: PublicKey;
  controllerConfig: PublicKey;
  governancePolicy: PublicKey;
  council: PublicKey;
  protocolGate: PublicKey;
  capacityPolicy: PublicKey;
  controllerImmutabilityReceipt: PublicKey;
  bridgeObservation: PublicKey;
  targetProgram: PublicKey;
  targetProgramdata: PublicKey;
  legacyAuthority: PublicKey;
  controllerAuthority: PublicKey;
  lifecycleRegistry: PublicKey;
  governingTimingProfile: PublicKey;
  proposal: PublicKey;
  upgradeableLoader: PublicKey;
  systemProgram: PublicKey;
}

export interface TargetAuthorityHandoffEvidenceV2Accounts {
  controllerProgram: PublicKey;
  controllerProgramdata: PublicKey;
  controllerConfig: PublicKey;
  governancePolicy: PublicKey;
  council: PublicKey;
  protocolGate: PublicKey;
  capacityPolicy: PublicKey;
  controllerImmutabilityReceipt: PublicKey;
  bridgeObservation: PublicKey;
  targetProgram: PublicKey;
  targetProgramdata: PublicKey;
  legacyAuthority: PublicKey;
  controllerAuthority: PublicKey;
  lifecycleRegistry: PublicKey;
  governingTimingProfile: PublicKey;
  proposal: PublicKey;
  upgradeableLoader: PublicKey;
}

export interface ApproveTargetAuthorityHandoffProposalV2Accounts extends TargetAuthorityHandoffEvidenceV2Accounts {
  seatAuthority: PublicKey;
}

export interface CancelTargetAuthorityHandoffProposalV2Accounts {
  controllerConfig: PublicKey;
  governancePolicy: PublicKey;
  council: PublicKey;
  protocolGate: PublicKey;
  lifecycleRegistry: PublicKey;
  governingTimingProfile: PublicKey;
  proposal: PublicKey;
  seatAuthority: PublicKey;
}

export interface ExpireTargetAuthorityHandoffProposalV2Accounts {
  controllerConfig: PublicKey;
  lifecycleRegistry: PublicKey;
  governingTimingProfile: PublicKey;
  proposal: PublicKey;
}

export type QueueTargetAuthorityHandoffProposalV2Accounts = TargetAuthorityHandoffEvidenceV2Accounts;

export interface ExecuteTargetAuthorityHandoffProposalV2Accounts {
  payer: PublicKey;
  controllerProgram: PublicKey;
  controllerProgramdata: PublicKey;
  controllerConfig: PublicKey;
  governancePolicy: PublicKey;
  council: PublicKey;
  protocolGate: PublicKey;
  capacityPolicy: PublicKey;
  controllerImmutabilityReceipt: PublicKey;
  lifecycleRegistry: PublicKey;
  governingTimingProfile: PublicKey;
  proposal: PublicKey;
  bridgeObservation: PublicKey;
  targetProgram: PublicKey;
  targetProgramdata: PublicKey;
  legacyAuthority: PublicKey;
  controllerAuthority: PublicKey;
  upgradeableLoader: PublicKey;
  targetHandoffReceipt: PublicKey;
  systemProgram: PublicKey;
  instructionsSysvar: PublicKey;
}

export interface CreateBootstrapActivationProposalV2Accounts {
  payer: PublicKey;
  creator: PublicKey;
  controllerProgram: PublicKey;
  controllerProgramdata: PublicKey;
  controllerConfig: PublicKey;
  governancePolicy: PublicKey;
  council: PublicKey;
  protocolGate: PublicKey;
  capacityPolicy: PublicKey;
  controllerImmutabilityReceipt: PublicKey;
  targetHandoffReceipt: PublicKey;
  bridgeObservation: PublicKey;
  targetProgram: PublicKey;
  targetProgramdata: PublicKey;
  controllerAuthority: PublicKey;
  lifecycleRegistry: PublicKey;
  governingTimingProfile: PublicKey;
  proposal: PublicKey;
  upgradeableLoader: PublicKey;
  systemProgram: PublicKey;
}

export interface BootstrapActivationEvidenceV2Accounts {
  controllerProgram: PublicKey;
  controllerProgramdata: PublicKey;
  controllerConfig: PublicKey;
  governancePolicy: PublicKey;
  council: PublicKey;
  protocolGate: PublicKey;
  capacityPolicy: PublicKey;
  controllerImmutabilityReceipt: PublicKey;
  targetHandoffReceipt: PublicKey;
  bridgeObservation: PublicKey;
  targetProgram: PublicKey;
  targetProgramdata: PublicKey;
  controllerAuthority: PublicKey;
  lifecycleRegistry: PublicKey;
  governingTimingProfile: PublicKey;
  proposal: PublicKey;
  upgradeableLoader: PublicKey;
}

export interface ApproveBootstrapActivationProposalV2Accounts extends BootstrapActivationEvidenceV2Accounts {
  seatAuthority: PublicKey;
}

export interface CancelBootstrapActivationProposalV2Accounts {
  controllerConfig: PublicKey;
  governancePolicy: PublicKey;
  council: PublicKey;
  protocolGate: PublicKey;
  lifecycleRegistry: PublicKey;
  governingTimingProfile: PublicKey;
  proposal: PublicKey;
  seatAuthority: PublicKey;
}

export interface ExpireBootstrapActivationProposalV2Accounts {
  controllerConfig: PublicKey;
  lifecycleRegistry: PublicKey;
  governingTimingProfile: PublicKey;
  proposal: PublicKey;
}

export type QueueBootstrapActivationProposalV2Accounts = BootstrapActivationEvidenceV2Accounts;

export interface ExecuteBootstrapActivationProposalV2Accounts {
  payer: PublicKey;
  controllerProgram: PublicKey;
  controllerProgramdata: PublicKey;
  controllerConfig: PublicKey;
  governancePolicy: PublicKey;
  council: PublicKey;
  protocolGate: PublicKey;
  capacityPolicy: PublicKey;
  controllerImmutabilityReceipt: PublicKey;
  targetHandoffReceipt: PublicKey;
  lifecycleRegistry: PublicKey;
  governingTimingProfile: PublicKey;
  proposal: PublicKey;
  bridgeObservation: PublicKey;
  targetProgram: PublicKey;
  targetProgramdata: PublicKey;
  controllerAuthority: PublicKey;
  upgradeableLoader: PublicKey;
  bootstrapActivationReceipt: PublicKey;
  currentDeployment: PublicKey;
  systemProgram: PublicKey;
  instructionsSysvar: PublicKey;
}

const timingPolicyActionKeys = (accounts: TimingPolicyChangeActionV1Accounts) => [
  ro(accounts.controllerConfig),
  ro(accounts.governancePolicy),
  ro(accounts.council),
  ro(accounts.protocolGate),
  ro(accounts.lifecycleRegistry),
  ro(accounts.governingTimingProfile),
  ro(accounts.candidateTimingProfile),
  rw(accounts.proposal),
];

const councilRotationActionKeys = (accounts: CouncilRotationActionV2Accounts) => [
  ro(accounts.controllerConfig),
  ro(accounts.governancePolicy),
  ro(accounts.currentCouncil),
  ro(accounts.candidateCouncil),
  ro(accounts.protocolGate),
  ro(accounts.lifecycleRegistry),
  ro(accounts.governingTimingProfile),
  rw(accounts.proposal),
];

const handoffEvidenceKeys = (accounts: TargetAuthorityHandoffEvidenceV2Accounts) => [
  ro(accounts.controllerProgram),
  ro(accounts.controllerProgramdata),
  ro(accounts.controllerConfig),
  ro(accounts.governancePolicy),
  ro(accounts.council),
  ro(accounts.protocolGate),
  ro(accounts.capacityPolicy),
  ro(accounts.controllerImmutabilityReceipt),
  ro(accounts.bridgeObservation),
  ro(accounts.targetProgram),
  ro(accounts.targetProgramdata),
  ro(accounts.legacyAuthority),
  ro(accounts.controllerAuthority),
  ro(accounts.lifecycleRegistry),
  ro(accounts.governingTimingProfile),
  rw(accounts.proposal),
  ro(accounts.upgradeableLoader),
];

const activationEvidenceKeys = (accounts: BootstrapActivationEvidenceV2Accounts) => [
  ro(accounts.controllerProgram),
  ro(accounts.controllerProgramdata),
  ro(accounts.controllerConfig),
  ro(accounts.governancePolicy),
  ro(accounts.council),
  ro(accounts.protocolGate),
  ro(accounts.capacityPolicy),
  ro(accounts.controllerImmutabilityReceipt),
  ro(accounts.targetHandoffReceipt),
  ro(accounts.bridgeObservation),
  ro(accounts.targetProgram),
  ro(accounts.targetProgramdata),
  ro(accounts.controllerAuthority),
  ro(accounts.lifecycleRegistry),
  ro(accounts.governingTimingProfile),
  rw(accounts.proposal),
  ro(accounts.upgradeableLoader),
];

export function buildInitializeGovernanceLifecycleRegistryV2Instruction(
  programId: PublicKey,
  accounts: InitializeGovernanceLifecycleRegistryV2Accounts,
  value: abi.InitializeGovernanceLifecycleRegistryV2,
): TransactionInstruction {
  return controllerInstruction(programId, accounts.controllerProgram, [
    ws(accounts.payer),
    rs(accounts.initializer),
    ro(accounts.controllerProgram),
    ro(accounts.controllerProgramdata),
    ro(accounts.controllerConfig),
    ro(accounts.governancePolicy),
    ro(accounts.council),
    ro(accounts.protocolGate),
    rw(accounts.lifecycleRegistry),
    rw(accounts.initialTimingProfile),
    ro(accounts.systemProgram),
  ], abi.encodeInitializeGovernanceLifecycleRegistryV2(value));
}

export function buildCreateGovernanceTimingProfileV1Instruction(
  programId: PublicKey,
  accounts: CreateGovernanceTimingProfileV1Accounts,
  value: abi.CreateGovernanceTimingProfileV1,
): TransactionInstruction {
  return fixedInstruction(programId, [
    ws(accounts.payer),
    rs(accounts.creator),
    ro(accounts.controllerConfig),
    ro(accounts.governancePolicy),
    ro(accounts.council),
    ro(accounts.protocolGate),
    rw(accounts.lifecycleRegistry),
    ro(accounts.currentTimingProfile),
    rw(accounts.candidateTimingProfile),
    ro(accounts.systemProgram),
  ], abi.encodeCreateGovernanceTimingProfileV1(value));
}

export function buildCreateTimingPolicyChangeProposalV1Instruction(
  programId: PublicKey,
  accounts: CreateTimingPolicyChangeProposalV1Accounts,
  value: abi.CreateTimingPolicyChangeProposalV1,
): TransactionInstruction {
  return fixedInstruction(programId, [
    ws(accounts.payer),
    rs(accounts.creator),
    ro(accounts.controllerConfig),
    ro(accounts.governancePolicy),
    ro(accounts.council),
    ro(accounts.protocolGate),
    rw(accounts.lifecycleRegistry),
    ro(accounts.governingTimingProfile),
    ro(accounts.candidateTimingProfile),
    rw(accounts.proposal),
    ro(accounts.systemProgram),
  ], abi.encodeCreateTimingPolicyChangeProposalV1(value));
}

export function buildApproveTimingPolicyChangeProposalV1Instruction(
  programId: PublicKey,
  accounts: ApproveTimingPolicyChangeProposalV1Accounts,
  value: abi.ApproveTimingPolicyChangeProposalV1,
): TransactionInstruction {
  return fixedInstruction(programId, [...timingPolicyActionKeys(accounts), rs(accounts.seatAuthority)], abi.encodeApproveTimingPolicyChangeProposalV1(value));
}

export function buildCancelTimingPolicyChangeProposalV1Instruction(
  programId: PublicKey,
  accounts: CancelTimingPolicyChangeProposalV1Accounts,
  value: abi.CancelTimingPolicyChangeProposalV1,
): TransactionInstruction {
  return fixedInstruction(programId, [...timingPolicyActionKeys(accounts), rs(accounts.seatAuthority)], abi.encodeCancelTimingPolicyChangeProposalV1(value));
}

export function buildExpireTimingPolicyChangeProposalV1Instruction(
  programId: PublicKey,
  accounts: ExpireTimingPolicyChangeProposalV1Accounts,
  value: abi.ExpireTimingPolicyChangeProposalV1,
): TransactionInstruction {
  return fixedInstruction(programId, timingPolicyActionKeys(accounts), abi.encodeExpireTimingPolicyChangeProposalV1(value));
}

export function buildQueueTimingPolicyChangeProposalV1Instruction(
  programId: PublicKey,
  accounts: QueueTimingPolicyChangeProposalV1Accounts,
  value: abi.QueueTimingPolicyChangeProposalV1,
): TransactionInstruction {
  return fixedInstruction(programId, timingPolicyActionKeys(accounts), abi.encodeQueueTimingPolicyChangeProposalV1(value));
}

export function buildExecuteTimingPolicyChangeProposalV1Instruction(
  programId: PublicKey,
  accounts: ExecuteTimingPolicyChangeProposalV1Accounts,
  value: abi.ExecuteTimingPolicyChangeProposalV1,
): TransactionInstruction {
  return fixedInstruction(programId, [
    ro(accounts.controllerConfig),
    ro(accounts.governancePolicy),
    ro(accounts.council),
    ro(accounts.protocolGate),
    rw(accounts.lifecycleRegistry),
    ro(accounts.governingTimingProfile),
    ro(accounts.candidateTimingProfile),
    rw(accounts.proposal),
  ], abi.encodeExecuteTimingPolicyChangeProposalV1(value));
}

export function buildCreateCouncilRotationProposalV2Instruction(
  programId: PublicKey,
  accounts: CreateCouncilRotationProposalV2Accounts,
  value: abi.CreateCouncilRotationProposalV2,
): TransactionInstruction {
  return fixedInstruction(programId, [
    ws(accounts.payer),
    rs(accounts.creator),
    ro(accounts.controllerConfig),
    ro(accounts.governancePolicy),
    ro(accounts.currentCouncil),
    ro(accounts.candidateCouncil),
    ro(accounts.protocolGate),
    rw(accounts.lifecycleRegistry),
    ro(accounts.governingTimingProfile),
    rw(accounts.proposal),
    ro(accounts.systemProgram),
  ], abi.encodeCreateCouncilRotationProposalV2(value));
}

export function buildApproveCouncilRotationProposalV2Instruction(
  programId: PublicKey,
  accounts: ApproveCouncilRotationProposalV2Accounts,
  value: abi.ApproveCouncilRotationProposalV2,
): TransactionInstruction {
  return fixedInstruction(programId, [...councilRotationActionKeys(accounts), rs(accounts.seatAuthority)], abi.encodeApproveCouncilRotationProposalV2(value));
}

export function buildCancelCouncilRotationProposalV2Instruction(
  programId: PublicKey,
  accounts: CancelCouncilRotationProposalV2Accounts,
  value: abi.CancelCouncilRotationProposalV2,
): TransactionInstruction {
  return fixedInstruction(programId, [...councilRotationActionKeys(accounts), rs(accounts.seatAuthority)], abi.encodeCancelCouncilRotationProposalV2(value));
}

export function buildExpireCouncilRotationProposalV2Instruction(
  programId: PublicKey,
  accounts: ExpireCouncilRotationProposalV2Accounts,
  value: abi.ExpireCouncilRotationProposalV2,
): TransactionInstruction {
  return fixedInstruction(programId, [
    ro(accounts.controllerConfig),
    ro(accounts.governancePolicy),
    ro(accounts.currentCouncil),
    ro(accounts.protocolGate),
    ro(accounts.lifecycleRegistry),
    ro(accounts.governingTimingProfile),
    rw(accounts.proposal),
  ], abi.encodeExpireCouncilRotationProposalV2(value));
}

export function buildQueueCouncilRotationProposalV2Instruction(
  programId: PublicKey,
  accounts: QueueCouncilRotationProposalV2Accounts,
  value: abi.QueueCouncilRotationProposalV2,
): TransactionInstruction {
  return fixedInstruction(programId, councilRotationActionKeys(accounts), abi.encodeQueueCouncilRotationProposalV2(value));
}

export function buildExecuteCouncilRotationProposalV2Instruction(
  programId: PublicKey,
  accounts: ExecuteCouncilRotationProposalV2Accounts,
  value: abi.ExecuteCouncilRotationProposalV2,
): TransactionInstruction {
  return fixedInstruction(programId, [
    rw(accounts.controllerConfig),
    ro(accounts.governancePolicy),
    ro(accounts.currentCouncil),
    ro(accounts.candidateCouncil),
    ro(accounts.protocolGate),
    rw(accounts.lifecycleRegistry),
    ro(accounts.governingTimingProfile),
    rw(accounts.proposal),
  ], abi.encodeExecuteCouncilRotationProposalV2(value));
}

export function buildCreateTargetAuthorityHandoffProposalV2Instruction(
  programId: PublicKey,
  accounts: CreateTargetAuthorityHandoffProposalV2Accounts,
  value: abi.CreateTargetAuthorityHandoffProposalV2,
): TransactionInstruction {
  return controllerInstruction(programId, accounts.controllerProgram, [
    ws(accounts.payer),
    rs(accounts.creator),
    ro(accounts.controllerProgram),
    ro(accounts.controllerProgramdata),
    ro(accounts.controllerConfig),
    ro(accounts.governancePolicy),
    ro(accounts.council),
    ro(accounts.protocolGate),
    ro(accounts.capacityPolicy),
    ro(accounts.controllerImmutabilityReceipt),
    ro(accounts.bridgeObservation),
    ro(accounts.targetProgram),
    ro(accounts.targetProgramdata),
    ro(accounts.legacyAuthority),
    ro(accounts.controllerAuthority),
    rw(accounts.lifecycleRegistry),
    ro(accounts.governingTimingProfile),
    rw(accounts.proposal),
    ro(accounts.upgradeableLoader),
    ro(accounts.systemProgram),
  ], abi.encodeCreateTargetAuthorityHandoffProposalV2(value));
}

export function buildApproveTargetAuthorityHandoffProposalV2Instruction(
  programId: PublicKey,
  accounts: ApproveTargetAuthorityHandoffProposalV2Accounts,
  value: abi.ApproveTargetAuthorityHandoffProposalV2,
): TransactionInstruction {
  return controllerInstruction(programId, accounts.controllerProgram, [...handoffEvidenceKeys(accounts), rs(accounts.seatAuthority)], abi.encodeApproveTargetAuthorityHandoffProposalV2(value));
}

export function buildCancelTargetAuthorityHandoffProposalV2Instruction(
  programId: PublicKey,
  accounts: CancelTargetAuthorityHandoffProposalV2Accounts,
  value: abi.CancelTargetAuthorityHandoffProposalV2,
): TransactionInstruction {
  return fixedInstruction(programId, [
    ro(accounts.controllerConfig),
    ro(accounts.governancePolicy),
    ro(accounts.council),
    ro(accounts.protocolGate),
    ro(accounts.lifecycleRegistry),
    ro(accounts.governingTimingProfile),
    rw(accounts.proposal),
    rs(accounts.seatAuthority),
  ], abi.encodeCancelTargetAuthorityHandoffProposalV2(value));
}

export function buildExpireTargetAuthorityHandoffProposalV2Instruction(
  programId: PublicKey,
  accounts: ExpireTargetAuthorityHandoffProposalV2Accounts,
  value: abi.ExpireTargetAuthorityHandoffProposalV2,
): TransactionInstruction {
  return fixedInstruction(programId, [
    ro(accounts.controllerConfig),
    ro(accounts.lifecycleRegistry),
    ro(accounts.governingTimingProfile),
    rw(accounts.proposal),
  ], abi.encodeExpireTargetAuthorityHandoffProposalV2(value));
}

export function buildQueueTargetAuthorityHandoffProposalV2Instruction(
  programId: PublicKey,
  accounts: QueueTargetAuthorityHandoffProposalV2Accounts,
  value: abi.QueueTargetAuthorityHandoffProposalV2,
): TransactionInstruction {
  return controllerInstruction(programId, accounts.controllerProgram, handoffEvidenceKeys(accounts), abi.encodeQueueTargetAuthorityHandoffProposalV2(value));
}

export function buildExecuteTargetAuthorityHandoffProposalV2Instruction(
  programId: PublicKey,
  accounts: ExecuteTargetAuthorityHandoffProposalV2Accounts,
  value: abi.ExecuteTargetAuthorityHandoffProposalV2,
): TransactionInstruction {
  return controllerInstruction(programId, accounts.controllerProgram, [
    ws(accounts.payer),
    ro(accounts.controllerProgram),
    ro(accounts.controllerProgramdata),
    ro(accounts.controllerConfig),
    ro(accounts.governancePolicy),
    ro(accounts.council),
    ro(accounts.protocolGate),
    ro(accounts.capacityPolicy),
    ro(accounts.controllerImmutabilityReceipt),
    ro(accounts.lifecycleRegistry),
    ro(accounts.governingTimingProfile),
    rw(accounts.proposal),
    ro(accounts.bridgeObservation),
    ro(accounts.targetProgram),
    rw(accounts.targetProgramdata),
    rs(accounts.legacyAuthority),
    ro(accounts.controllerAuthority),
    ro(accounts.upgradeableLoader),
    rw(accounts.targetHandoffReceipt),
    ro(accounts.systemProgram),
    ro(accounts.instructionsSysvar),
  ], abi.encodeExecuteTargetAuthorityHandoffProposalV2(value));
}

export function buildCreateBootstrapActivationProposalV2Instruction(
  programId: PublicKey,
  accounts: CreateBootstrapActivationProposalV2Accounts,
  value: abi.CreateBootstrapActivationProposalV2,
): TransactionInstruction {
  return controllerInstruction(programId, accounts.controllerProgram, [
    ws(accounts.payer),
    rs(accounts.creator),
    ro(accounts.controllerProgram),
    ro(accounts.controllerProgramdata),
    ro(accounts.controllerConfig),
    ro(accounts.governancePolicy),
    ro(accounts.council),
    ro(accounts.protocolGate),
    ro(accounts.capacityPolicy),
    ro(accounts.controllerImmutabilityReceipt),
    ro(accounts.targetHandoffReceipt),
    ro(accounts.bridgeObservation),
    ro(accounts.targetProgram),
    ro(accounts.targetProgramdata),
    ro(accounts.controllerAuthority),
    rw(accounts.lifecycleRegistry),
    ro(accounts.governingTimingProfile),
    rw(accounts.proposal),
    ro(accounts.upgradeableLoader),
    ro(accounts.systemProgram),
  ], abi.encodeCreateBootstrapActivationProposalV2(value));
}

export function buildApproveBootstrapActivationProposalV2Instruction(
  programId: PublicKey,
  accounts: ApproveBootstrapActivationProposalV2Accounts,
  value: abi.ApproveBootstrapActivationProposalV2,
): TransactionInstruction {
  return controllerInstruction(programId, accounts.controllerProgram, [...activationEvidenceKeys(accounts), rs(accounts.seatAuthority)], abi.encodeApproveBootstrapActivationProposalV2(value));
}

export function buildCancelBootstrapActivationProposalV2Instruction(
  programId: PublicKey,
  accounts: CancelBootstrapActivationProposalV2Accounts,
  value: abi.CancelBootstrapActivationProposalV2,
): TransactionInstruction {
  return fixedInstruction(programId, [
    ro(accounts.controllerConfig),
    ro(accounts.governancePolicy),
    ro(accounts.council),
    ro(accounts.protocolGate),
    ro(accounts.lifecycleRegistry),
    ro(accounts.governingTimingProfile),
    rw(accounts.proposal),
    rs(accounts.seatAuthority),
  ], abi.encodeCancelBootstrapActivationProposalV2(value));
}

export function buildExpireBootstrapActivationProposalV2Instruction(
  programId: PublicKey,
  accounts: ExpireBootstrapActivationProposalV2Accounts,
  value: abi.ExpireBootstrapActivationProposalV2,
): TransactionInstruction {
  return fixedInstruction(programId, [
    ro(accounts.controllerConfig),
    ro(accounts.lifecycleRegistry),
    ro(accounts.governingTimingProfile),
    rw(accounts.proposal),
  ], abi.encodeExpireBootstrapActivationProposalV2(value));
}

export function buildQueueBootstrapActivationProposalV2Instruction(
  programId: PublicKey,
  accounts: QueueBootstrapActivationProposalV2Accounts,
  value: abi.QueueBootstrapActivationProposalV2,
): TransactionInstruction {
  return controllerInstruction(programId, accounts.controllerProgram, activationEvidenceKeys(accounts), abi.encodeQueueBootstrapActivationProposalV2(value));
}

export function buildExecuteBootstrapActivationProposalV2Instruction(
  programId: PublicKey,
  accounts: ExecuteBootstrapActivationProposalV2Accounts,
  value: abi.ExecuteBootstrapActivationProposalV2,
): TransactionInstruction {
  return controllerInstruction(programId, accounts.controllerProgram, [
    ws(accounts.payer),
    ro(accounts.controllerProgram),
    ro(accounts.controllerProgramdata),
    ro(accounts.controllerConfig),
    ro(accounts.governancePolicy),
    ro(accounts.council),
    rw(accounts.protocolGate),
    ro(accounts.capacityPolicy),
    ro(accounts.controllerImmutabilityReceipt),
    ro(accounts.targetHandoffReceipt),
    ro(accounts.lifecycleRegistry),
    ro(accounts.governingTimingProfile),
    rw(accounts.proposal),
    ro(accounts.bridgeObservation),
    ro(accounts.targetProgram),
    ro(accounts.targetProgramdata),
    ro(accounts.controllerAuthority),
    ro(accounts.upgradeableLoader),
    rw(accounts.bootstrapActivationReceipt),
    rw(accounts.currentDeployment),
    ro(accounts.systemProgram),
    ro(accounts.instructionsSysvar),
  ], abi.encodeExecuteBootstrapActivationProposalV2(value));
}
