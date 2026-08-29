import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import {
  CeremonyEnvelopeV1,
  FixedReader,
  FixedWriter,
  decodeFixed,
  encodeFixed,
  exactBytes,
  fixedInstruction,
  readCeremonyEnvelope,
  ro,
  rs,
  rw,
  writeCeremonyEnvelope,
  ws,
} from "./release1FixedWire.js";

export const RECORD_CONTROLLER_IMMUTABILITY_V1_TAG = 43;
export const CREATE_TARGET_AUTHORITY_HANDOFF_V1_TAG = 44;
export const APPROVE_TARGET_AUTHORITY_HANDOFF_V1_TAG = 45;
export const QUEUE_TARGET_AUTHORITY_HANDOFF_V1_TAG = 46;
export const ACCEPT_TARGET_AUTHORITY_CHECKED_V1_TAG = 47;
export const CREATE_BOOTSTRAP_ACTIVATION_V1_TAG = 49;
export const APPROVE_BOOTSTRAP_ACTIVATION_V1_TAG = 50;
export const QUEUE_BOOTSTRAP_ACTIVATION_V1_TAG = 51;
export const EXECUTE_BOOTSTRAP_ACTIVATION_V1_TAG = 52;

export const RECORD_CONTROLLER_IMMUTABILITY_V1_LEN = 161;
export const CREATE_TARGET_AUTHORITY_HANDOFF_V1_LEN = 161;
export const APPROVE_TARGET_AUTHORITY_HANDOFF_V1_LEN = 57;
export const QUEUE_TARGET_AUTHORITY_HANDOFF_V1_LEN = 57;
export const ACCEPT_TARGET_AUTHORITY_CHECKED_V1_LEN = 159;
export const CREATE_BOOTSTRAP_ACTIVATION_V1_LEN = 129;
export const APPROVE_BOOTSTRAP_ACTIVATION_V1_LEN = 57;
export const QUEUE_BOOTSTRAP_ACTIVATION_V1_LEN = 57;
export const EXECUTE_BOOTSTRAP_ACTIVATION_V1_LEN = 223;

type Digest = Buffer;

export interface RecordControllerImmutabilityV1 {
  expectedCapacityPolicyDigest: Digest;
  expectedReleaseDigest: Digest;
  expectedPreObservationDigest: Digest;
  expectedPostObservationDigest: Digest;
  expectedReceiptDigest: Digest;
}

export interface TargetAuthorityApprovalV1 {
  expectedProposalDigest: Digest;
  expectedCouncilVersion: bigint;
  expectedGateEpoch: bigint;
  expectedTargetNonce: bigint;
}

export interface CreateTargetAuthorityHandoffV1 {
  expectedGateEpoch: bigint;
  expectedTargetNonce: bigint;
  expectedCouncilVersion: bigint;
  bridgeSourceCommitment: Digest;
  bridgeBuildInputsCommitment: Digest;
  bridgePackageCommitment: Digest;
  bridgeReleaseManifestCommitment: Digest;
  planValidUntilSlot: bigint;
}

export type ApproveTargetAuthorityHandoffV1 = TargetAuthorityApprovalV1;
export type QueueTargetAuthorityHandoffV1 = TargetAuthorityApprovalV1;

export interface AcceptTargetAuthorityCheckedV1 {
  expectedProposalDigest: Digest;
  expectedBridgeObservationDigest: Digest;
  expectedGateEpoch: bigint;
  expectedTargetNonce: bigint;
  envelope: CeremonyEnvelopeV1;
}

export interface CreateBootstrapActivationV1 {
  expectedControllerImmutabilityDigest: Digest;
  expectedHandoffReceiptDigest: Digest;
  expectedBridgeObservationDigest: Digest;
  expectedGateEpoch: bigint;
  expectedTargetNonce: bigint;
  expectedCouncilVersion: bigint;
  planValidUntilSlot: bigint;
}

export type ApproveBootstrapActivationV1 = TargetAuthorityApprovalV1;
export type QueueBootstrapActivationV1 = TargetAuthorityApprovalV1;

export interface ExecuteBootstrapActivationV1 {
  expectedProposalDigest: Digest;
  expectedBridgeObservationDigest: Digest;
  expectedGateEpoch: bigint;
  expectedTargetNonce: bigint;
  expectedDeploymentDigest: Digest;
  expectedReceiptDigest: Digest;
  envelope: CeremonyEnvelopeV1;
}

const digest = (value: Digest, field: string): Digest => exactBytes(value, 32, field);

function writeApproval(writer: FixedWriter, value: TargetAuthorityApprovalV1): void {
  writer.bytes(digest(value.expectedProposalDigest, "expectedProposalDigest"), 32, "expectedProposalDigest")
    .u64(value.expectedCouncilVersion, "expectedCouncilVersion")
    .u64(value.expectedGateEpoch, "expectedGateEpoch")
    .u64(value.expectedTargetNonce, "expectedTargetNonce");
}

function readApproval(reader: FixedReader): TargetAuthorityApprovalV1 {
  return {
    expectedProposalDigest: reader.bytes(32),
    expectedCouncilVersion: reader.u64(),
    expectedGateEpoch: reader.u64(),
    expectedTargetNonce: reader.u64(),
  };
}

function validateApproval(value: TargetAuthorityApprovalV1): void {
  digest(value.expectedProposalDigest, "expectedProposalDigest");
}

export function encodeRecordControllerImmutabilityV1(value: RecordControllerImmutabilityV1): Buffer {
  return encodeFixed(RECORD_CONTROLLER_IMMUTABILITY_V1_TAG, RECORD_CONTROLLER_IMMUTABILITY_V1_LEN, (writer) => {
    writer.bytes(digest(value.expectedCapacityPolicyDigest, "expectedCapacityPolicyDigest"), 32, "expectedCapacityPolicyDigest")
      .bytes(digest(value.expectedReleaseDigest, "expectedReleaseDigest"), 32, "expectedReleaseDigest")
      .bytes(digest(value.expectedPreObservationDigest, "expectedPreObservationDigest"), 32, "expectedPreObservationDigest")
      .bytes(digest(value.expectedPostObservationDigest, "expectedPostObservationDigest"), 32, "expectedPostObservationDigest")
      .bytes(digest(value.expectedReceiptDigest, "expectedReceiptDigest"), 32, "expectedReceiptDigest");
  });
}

export function decodeRecordControllerImmutabilityV1(data: Buffer): RecordControllerImmutabilityV1 {
  return decodeFixed(data, RECORD_CONTROLLER_IMMUTABILITY_V1_TAG, RECORD_CONTROLLER_IMMUTABILITY_V1_LEN, (reader) => ({
    expectedCapacityPolicyDigest: reader.bytes(32),
    expectedReleaseDigest: reader.bytes(32),
    expectedPreObservationDigest: reader.bytes(32),
    expectedPostObservationDigest: reader.bytes(32),
    expectedReceiptDigest: reader.bytes(32),
  }), (value) => {
    Object.entries(value).forEach(([field, bytes]) => digest(bytes, field));
  });
}

export function encodeCreateTargetAuthorityHandoffV1(value: CreateTargetAuthorityHandoffV1): Buffer {
  return encodeFixed(CREATE_TARGET_AUTHORITY_HANDOFF_V1_TAG, CREATE_TARGET_AUTHORITY_HANDOFF_V1_LEN, (writer) => {
    writer.u64(value.expectedGateEpoch, "expectedGateEpoch")
      .u64(value.expectedTargetNonce, "expectedTargetNonce")
      .u64(value.expectedCouncilVersion, "expectedCouncilVersion")
      .bytes(digest(value.bridgeSourceCommitment, "bridgeSourceCommitment"), 32, "bridgeSourceCommitment")
      .bytes(digest(value.bridgeBuildInputsCommitment, "bridgeBuildInputsCommitment"), 32, "bridgeBuildInputsCommitment")
      .bytes(digest(value.bridgePackageCommitment, "bridgePackageCommitment"), 32, "bridgePackageCommitment")
      .bytes(digest(value.bridgeReleaseManifestCommitment, "bridgeReleaseManifestCommitment"), 32, "bridgeReleaseManifestCommitment")
      .u64(value.planValidUntilSlot, "planValidUntilSlot");
  });
}

export function decodeCreateTargetAuthorityHandoffV1(data: Buffer): CreateTargetAuthorityHandoffV1 {
  return decodeFixed(data, CREATE_TARGET_AUTHORITY_HANDOFF_V1_TAG, CREATE_TARGET_AUTHORITY_HANDOFF_V1_LEN, (reader) => ({
    expectedGateEpoch: reader.u64(), expectedTargetNonce: reader.u64(), expectedCouncilVersion: reader.u64(),
    bridgeSourceCommitment: reader.bytes(32), bridgeBuildInputsCommitment: reader.bytes(32),
    bridgePackageCommitment: reader.bytes(32), bridgeReleaseManifestCommitment: reader.bytes(32),
    planValidUntilSlot: reader.u64(),
  }), (value) => {
    digest(value.bridgeSourceCommitment, "bridgeSourceCommitment");
    digest(value.bridgeBuildInputsCommitment, "bridgeBuildInputsCommitment");
    digest(value.bridgePackageCommitment, "bridgePackageCommitment");
    digest(value.bridgeReleaseManifestCommitment, "bridgeReleaseManifestCommitment");
  });
}

function approvalCodec(tag: number, value: TargetAuthorityApprovalV1): Buffer {
  validateApproval(value);
  return encodeFixed(tag, 57, (writer) => writeApproval(writer, value));
}
function approvalDecode(data: Buffer, tag: number): TargetAuthorityApprovalV1 {
  return decodeFixed(data, tag, 57, readApproval, validateApproval);
}

export const encodeApproveTargetAuthorityHandoffV1 = (value: ApproveTargetAuthorityHandoffV1): Buffer => approvalCodec(APPROVE_TARGET_AUTHORITY_HANDOFF_V1_TAG, value);
export const decodeApproveTargetAuthorityHandoffV1 = (data: Buffer): ApproveTargetAuthorityHandoffV1 => approvalDecode(data, APPROVE_TARGET_AUTHORITY_HANDOFF_V1_TAG);
export const encodeQueueTargetAuthorityHandoffV1 = (value: QueueTargetAuthorityHandoffV1): Buffer => approvalCodec(QUEUE_TARGET_AUTHORITY_HANDOFF_V1_TAG, value);
export const decodeQueueTargetAuthorityHandoffV1 = (data: Buffer): QueueTargetAuthorityHandoffV1 => approvalDecode(data, QUEUE_TARGET_AUTHORITY_HANDOFF_V1_TAG);
export const encodeApproveBootstrapActivationV1 = (value: ApproveBootstrapActivationV1): Buffer => approvalCodec(APPROVE_BOOTSTRAP_ACTIVATION_V1_TAG, value);
export const decodeApproveBootstrapActivationV1 = (data: Buffer): ApproveBootstrapActivationV1 => approvalDecode(data, APPROVE_BOOTSTRAP_ACTIVATION_V1_TAG);
export const encodeQueueBootstrapActivationV1 = (value: QueueBootstrapActivationV1): Buffer => approvalCodec(QUEUE_BOOTSTRAP_ACTIVATION_V1_TAG, value);
export const decodeQueueBootstrapActivationV1 = (data: Buffer): QueueBootstrapActivationV1 => approvalDecode(data, QUEUE_BOOTSTRAP_ACTIVATION_V1_TAG);

export function encodeAcceptTargetAuthorityCheckedV1(value: AcceptTargetAuthorityCheckedV1): Buffer {
  return encodeFixed(ACCEPT_TARGET_AUTHORITY_CHECKED_V1_TAG, ACCEPT_TARGET_AUTHORITY_CHECKED_V1_LEN, (writer) => {
    writer.bytes(digest(value.expectedProposalDigest, "expectedProposalDigest"), 32, "expectedProposalDigest")
      .bytes(digest(value.expectedBridgeObservationDigest, "expectedBridgeObservationDigest"), 32, "expectedBridgeObservationDigest")
      .u64(value.expectedGateEpoch, "expectedGateEpoch").u64(value.expectedTargetNonce, "expectedTargetNonce");
    writeCeremonyEnvelope(writer, value.envelope);
  });
}

export function decodeAcceptTargetAuthorityCheckedV1(data: Buffer): AcceptTargetAuthorityCheckedV1 {
  return decodeFixed(data, ACCEPT_TARGET_AUTHORITY_CHECKED_V1_TAG, ACCEPT_TARGET_AUTHORITY_CHECKED_V1_LEN, (reader) => ({
    expectedProposalDigest: reader.bytes(32), expectedBridgeObservationDigest: reader.bytes(32),
    expectedGateEpoch: reader.u64(), expectedTargetNonce: reader.u64(), envelope: readCeremonyEnvelope(reader),
  }), (value) => {
    digest(value.expectedProposalDigest, "expectedProposalDigest");
    digest(value.expectedBridgeObservationDigest, "expectedBridgeObservationDigest");
  });
}

export function encodeCreateBootstrapActivationV1(value: CreateBootstrapActivationV1): Buffer {
  return encodeFixed(CREATE_BOOTSTRAP_ACTIVATION_V1_TAG, CREATE_BOOTSTRAP_ACTIVATION_V1_LEN, (writer) => {
    writer.bytes(digest(value.expectedControllerImmutabilityDigest, "expectedControllerImmutabilityDigest"), 32, "expectedControllerImmutabilityDigest")
      .bytes(digest(value.expectedHandoffReceiptDigest, "expectedHandoffReceiptDigest"), 32, "expectedHandoffReceiptDigest")
      .bytes(digest(value.expectedBridgeObservationDigest, "expectedBridgeObservationDigest"), 32, "expectedBridgeObservationDigest")
      .u64(value.expectedGateEpoch, "expectedGateEpoch").u64(value.expectedTargetNonce, "expectedTargetNonce")
      .u64(value.expectedCouncilVersion, "expectedCouncilVersion").u64(value.planValidUntilSlot, "planValidUntilSlot");
  });
}

export function decodeCreateBootstrapActivationV1(data: Buffer): CreateBootstrapActivationV1 {
  return decodeFixed(data, CREATE_BOOTSTRAP_ACTIVATION_V1_TAG, CREATE_BOOTSTRAP_ACTIVATION_V1_LEN, (reader) => ({
    expectedControllerImmutabilityDigest: reader.bytes(32), expectedHandoffReceiptDigest: reader.bytes(32),
    expectedBridgeObservationDigest: reader.bytes(32), expectedGateEpoch: reader.u64(), expectedTargetNonce: reader.u64(),
    expectedCouncilVersion: reader.u64(), planValidUntilSlot: reader.u64(),
  }), (value) => {
    digest(value.expectedControllerImmutabilityDigest, "expectedControllerImmutabilityDigest");
    digest(value.expectedHandoffReceiptDigest, "expectedHandoffReceiptDigest");
    digest(value.expectedBridgeObservationDigest, "expectedBridgeObservationDigest");
  });
}

export function encodeExecuteBootstrapActivationV1(value: ExecuteBootstrapActivationV1): Buffer {
  return encodeFixed(EXECUTE_BOOTSTRAP_ACTIVATION_V1_TAG, EXECUTE_BOOTSTRAP_ACTIVATION_V1_LEN, (writer) => {
    writer.bytes(digest(value.expectedProposalDigest, "expectedProposalDigest"), 32, "expectedProposalDigest")
      .bytes(digest(value.expectedBridgeObservationDigest, "expectedBridgeObservationDigest"), 32, "expectedBridgeObservationDigest")
      .u64(value.expectedGateEpoch, "expectedGateEpoch").u64(value.expectedTargetNonce, "expectedTargetNonce")
      .bytes(digest(value.expectedDeploymentDigest, "expectedDeploymentDigest"), 32, "expectedDeploymentDigest")
      .bytes(digest(value.expectedReceiptDigest, "expectedReceiptDigest"), 32, "expectedReceiptDigest");
    writeCeremonyEnvelope(writer, value.envelope);
  });
}

export function decodeExecuteBootstrapActivationV1(data: Buffer): ExecuteBootstrapActivationV1 {
  return decodeFixed(data, EXECUTE_BOOTSTRAP_ACTIVATION_V1_TAG, EXECUTE_BOOTSTRAP_ACTIVATION_V1_LEN, (reader) => ({
    expectedProposalDigest: reader.bytes(32), expectedBridgeObservationDigest: reader.bytes(32),
    expectedGateEpoch: reader.u64(), expectedTargetNonce: reader.u64(), expectedDeploymentDigest: reader.bytes(32),
    expectedReceiptDigest: reader.bytes(32), envelope: readCeremonyEnvelope(reader),
  }), (value) => {
    digest(value.expectedProposalDigest, "expectedProposalDigest");
    digest(value.expectedBridgeObservationDigest, "expectedBridgeObservationDigest");
    digest(value.expectedDeploymentDigest, "expectedDeploymentDigest");
    digest(value.expectedReceiptDigest, "expectedReceiptDigest");
  });
}

export type Release1AuthorityInstructionV1 =
  | { tag: 43; value: RecordControllerImmutabilityV1 }
  | { tag: 44; value: CreateTargetAuthorityHandoffV1 }
  | { tag: 45; value: ApproveTargetAuthorityHandoffV1 }
  | { tag: 46; value: QueueTargetAuthorityHandoffV1 }
  | { tag: 47; value: AcceptTargetAuthorityCheckedV1 }
  | { tag: 49; value: CreateBootstrapActivationV1 }
  | { tag: 50; value: ApproveBootstrapActivationV1 }
  | { tag: 51; value: QueueBootstrapActivationV1 }
  | { tag: 52; value: ExecuteBootstrapActivationV1 };

export function decodeRelease1AuthorityInstructionV1(data: Buffer): Release1AuthorityInstructionV1 {
  switch (data[0]) {
    case 43: return { tag: 43, value: decodeRecordControllerImmutabilityV1(data) };
    case 44: return { tag: 44, value: decodeCreateTargetAuthorityHandoffV1(data) };
    case 45: return { tag: 45, value: decodeApproveTargetAuthorityHandoffV1(data) };
    case 46: return { tag: 46, value: decodeQueueTargetAuthorityHandoffV1(data) };
    case 47: return { tag: 47, value: decodeAcceptTargetAuthorityCheckedV1(data) };
    case 49: return { tag: 49, value: decodeCreateBootstrapActivationV1(data) };
    case 50: return { tag: 50, value: decodeApproveBootstrapActivationV1(data) };
    case 51: return { tag: 51, value: decodeQueueBootstrapActivationV1(data) };
    case 52: return { tag: 52, value: decodeExecuteBootstrapActivationV1(data) };
    default: throw new Error("unknown Release 1 authority instruction tag");
  }
}

export interface RecordControllerImmutabilityV1Accounts {
  payer: PublicKey; controllerProgram: PublicKey; controllerProgramdata: PublicKey; controllerConfig: PublicKey;
  capacityPolicy: PublicKey; controllerRelease: PublicKey; preObservation: PublicKey; postObservation: PublicKey;
  immutabilityReceipt: PublicKey; upgradeableLoader: PublicKey; systemProgram: PublicKey;
}
export interface CreateTargetAuthorityHandoffV1Accounts {
  payer: PublicKey; creator: PublicKey; controllerProgram: PublicKey; controllerProgramdata: PublicKey;
  controllerConfig: PublicKey; governancePolicy: PublicKey; council: PublicKey; protocolGate: PublicKey;
  capacityPolicy: PublicKey; immutabilityReceipt: PublicKey; bridgeObservation: PublicKey; targetProgram: PublicKey;
  targetProgramdata: PublicKey; legacyAuthority: PublicKey; controllerAuthority: PublicKey; proposal: PublicKey;
  upgradeableLoader: PublicKey; systemProgram: PublicKey;
}
export interface TargetAuthorityHandoffApprovalV1Accounts {
  controllerProgram: PublicKey; controllerProgramdata: PublicKey; controllerConfig: PublicKey; governancePolicy: PublicKey;
  council: PublicKey; protocolGate: PublicKey; capacityPolicy: PublicKey; immutabilityReceipt: PublicKey;
  bridgeObservation: PublicKey; targetProgram: PublicKey; targetProgramdata: PublicKey; legacyAuthority: PublicKey;
  controllerAuthority: PublicKey; proposal: PublicKey; upgradeableLoader: PublicKey; seatAuthority: PublicKey;
}
export type QueueTargetAuthorityHandoffV1Accounts = Omit<TargetAuthorityHandoffApprovalV1Accounts, "seatAuthority">;
export interface AcceptTargetAuthorityCheckedV1Accounts {
  payer: PublicKey; controllerProgram: PublicKey; controllerProgramdata: PublicKey; controllerConfig: PublicKey;
  governancePolicy: PublicKey; council: PublicKey; protocolGate: PublicKey; capacityPolicy: PublicKey;
  immutabilityReceipt: PublicKey; proposal: PublicKey; bridgeObservation: PublicKey; targetProgram: PublicKey;
  targetProgramdata: PublicKey; legacyAuthority: PublicKey; controllerAuthority: PublicKey; upgradeableLoader: PublicKey;
  handoffReceipt: PublicKey; systemProgram: PublicKey; instructionsSysvar: PublicKey;
}
export interface CreateBootstrapActivationV1Accounts {
  payer: PublicKey; creator: PublicKey; controllerProgram: PublicKey; controllerProgramdata: PublicKey;
  controllerConfig: PublicKey; governancePolicy: PublicKey; council: PublicKey; protocolGate: PublicKey;
  capacityPolicy: PublicKey; immutabilityReceipt: PublicKey; handoffReceipt: PublicKey; bridgeObservation: PublicKey;
  targetProgram: PublicKey; targetProgramdata: PublicKey; controllerAuthority: PublicKey; proposal: PublicKey;
  activationReceipt: PublicKey; currentDeployment: PublicKey; upgradeableLoader: PublicKey; systemProgram: PublicKey;
}
export interface BootstrapActivationApprovalV1Accounts {
  controllerProgram: PublicKey; controllerProgramdata: PublicKey; controllerConfig: PublicKey; governancePolicy: PublicKey;
  council: PublicKey; protocolGate: PublicKey; capacityPolicy: PublicKey; immutabilityReceipt: PublicKey;
  handoffReceipt: PublicKey; bridgeObservation: PublicKey; targetProgram: PublicKey; targetProgramdata: PublicKey;
  controllerAuthority: PublicKey; proposal: PublicKey; upgradeableLoader: PublicKey; seatAuthority: PublicKey;
}
export type QueueBootstrapActivationV1Accounts = Omit<BootstrapActivationApprovalV1Accounts, "seatAuthority">;
export interface ExecuteBootstrapActivationV1Accounts {
  controllerProgram: PublicKey; controllerProgramdata: PublicKey; controllerConfig: PublicKey; governancePolicy: PublicKey;
  council: PublicKey; protocolGate: PublicKey; capacityPolicy: PublicKey; immutabilityReceipt: PublicKey;
  handoffReceipt: PublicKey; proposal: PublicKey; bridgeObservation: PublicKey; targetProgram: PublicKey;
  targetProgramdata: PublicKey; controllerAuthority: PublicKey; upgradeableLoader: PublicKey; activationReceipt: PublicKey;
  currentDeployment: PublicKey; instructionsSysvar: PublicKey;
}

export const buildRecordControllerImmutabilityV1Instruction = (programId: PublicKey, a: RecordControllerImmutabilityV1Accounts, v: RecordControllerImmutabilityV1): TransactionInstruction => fixedInstruction(programId, [ws(a.payer), ro(a.controllerProgram), ro(a.controllerProgramdata), ro(a.controllerConfig), ro(a.capacityPolicy), ro(a.controllerRelease), ro(a.preObservation), ro(a.postObservation), rw(a.immutabilityReceipt), ro(a.upgradeableLoader), ro(a.systemProgram)], encodeRecordControllerImmutabilityV1(v));
export const buildCreateTargetAuthorityHandoffV1Instruction = (programId: PublicKey, a: CreateTargetAuthorityHandoffV1Accounts, v: CreateTargetAuthorityHandoffV1): TransactionInstruction => fixedInstruction(programId, [ws(a.payer), rs(a.creator), ro(a.controllerProgram), ro(a.controllerProgramdata), ro(a.controllerConfig), ro(a.governancePolicy), ro(a.council), ro(a.protocolGate), ro(a.capacityPolicy), ro(a.immutabilityReceipt), ro(a.bridgeObservation), ro(a.targetProgram), ro(a.targetProgramdata), ro(a.legacyAuthority), ro(a.controllerAuthority), rw(a.proposal), ro(a.upgradeableLoader), ro(a.systemProgram)], encodeCreateTargetAuthorityHandoffV1(v));
const handoffApprovalKeys = (a: QueueTargetAuthorityHandoffV1Accounts) => [ro(a.controllerProgram), ro(a.controllerProgramdata), ro(a.controllerConfig), ro(a.governancePolicy), ro(a.council), ro(a.protocolGate), ro(a.capacityPolicy), ro(a.immutabilityReceipt), ro(a.bridgeObservation), ro(a.targetProgram), ro(a.targetProgramdata), ro(a.legacyAuthority), ro(a.controllerAuthority), rw(a.proposal), ro(a.upgradeableLoader)];
export const buildApproveTargetAuthorityHandoffV1Instruction = (programId: PublicKey, a: TargetAuthorityHandoffApprovalV1Accounts, v: ApproveTargetAuthorityHandoffV1): TransactionInstruction => fixedInstruction(programId, [...handoffApprovalKeys(a), rs(a.seatAuthority)], encodeApproveTargetAuthorityHandoffV1(v));
export const buildQueueTargetAuthorityHandoffV1Instruction = (programId: PublicKey, a: QueueTargetAuthorityHandoffV1Accounts, v: QueueTargetAuthorityHandoffV1): TransactionInstruction => fixedInstruction(programId, handoffApprovalKeys(a), encodeQueueTargetAuthorityHandoffV1(v));
export const buildAcceptTargetAuthorityCheckedV1Instruction = (programId: PublicKey, a: AcceptTargetAuthorityCheckedV1Accounts, v: AcceptTargetAuthorityCheckedV1): TransactionInstruction => fixedInstruction(programId, [ws(a.payer), ro(a.controllerProgram), ro(a.controllerProgramdata), ro(a.controllerConfig), ro(a.governancePolicy), ro(a.council), ro(a.protocolGate), ro(a.capacityPolicy), ro(a.immutabilityReceipt), rw(a.proposal), ro(a.bridgeObservation), ro(a.targetProgram), rw(a.targetProgramdata), rs(a.legacyAuthority), ro(a.controllerAuthority), ro(a.upgradeableLoader), rw(a.handoffReceipt), ro(a.systemProgram), ro(a.instructionsSysvar)], encodeAcceptTargetAuthorityCheckedV1(v));
export const buildCreateBootstrapActivationV1Instruction = (programId: PublicKey, a: CreateBootstrapActivationV1Accounts, v: CreateBootstrapActivationV1): TransactionInstruction => fixedInstruction(programId, [ws(a.payer), rs(a.creator), ro(a.controllerProgram), ro(a.controllerProgramdata), ro(a.controllerConfig), ro(a.governancePolicy), ro(a.council), ro(a.protocolGate), ro(a.capacityPolicy), ro(a.immutabilityReceipt), ro(a.handoffReceipt), ro(a.bridgeObservation), ro(a.targetProgram), ro(a.targetProgramdata), ro(a.controllerAuthority), rw(a.proposal), rw(a.activationReceipt), rw(a.currentDeployment), ro(a.upgradeableLoader), ro(a.systemProgram)], encodeCreateBootstrapActivationV1(v));
const activationApprovalKeys = (a: QueueBootstrapActivationV1Accounts) => [ro(a.controllerProgram), ro(a.controllerProgramdata), ro(a.controllerConfig), ro(a.governancePolicy), ro(a.council), ro(a.protocolGate), ro(a.capacityPolicy), ro(a.immutabilityReceipt), ro(a.handoffReceipt), ro(a.bridgeObservation), ro(a.targetProgram), ro(a.targetProgramdata), ro(a.controllerAuthority), rw(a.proposal), ro(a.upgradeableLoader)];
export const buildApproveBootstrapActivationV1Instruction = (programId: PublicKey, a: BootstrapActivationApprovalV1Accounts, v: ApproveBootstrapActivationV1): TransactionInstruction => fixedInstruction(programId, [...activationApprovalKeys(a), rs(a.seatAuthority)], encodeApproveBootstrapActivationV1(v));
export const buildQueueBootstrapActivationV1Instruction = (programId: PublicKey, a: QueueBootstrapActivationV1Accounts, v: QueueBootstrapActivationV1): TransactionInstruction => fixedInstruction(programId, activationApprovalKeys(a), encodeQueueBootstrapActivationV1(v));
export const buildExecuteBootstrapActivationV1Instruction = (programId: PublicKey, a: ExecuteBootstrapActivationV1Accounts, v: ExecuteBootstrapActivationV1): TransactionInstruction => fixedInstruction(programId, [ro(a.controllerProgram), ro(a.controllerProgramdata), ro(a.controllerConfig), ro(a.governancePolicy), ro(a.council), rw(a.protocolGate), ro(a.capacityPolicy), ro(a.immutabilityReceipt), ro(a.handoffReceipt), rw(a.proposal), ro(a.bridgeObservation), ro(a.targetProgram), ro(a.targetProgramdata), ro(a.controllerAuthority), ro(a.upgradeableLoader), rw(a.activationReceipt), rw(a.currentDeployment), ro(a.instructionsSysvar)], encodeExecuteBootstrapActivationV1(v));
