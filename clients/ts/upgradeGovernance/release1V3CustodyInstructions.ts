import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import {
  BufferVerificationStatusV1,
  type BufferVerificationStatusV1 as BufferStatus,
} from "./release1.js";
import {
  type CeremonyEnvelopeV1,
  FixedReader, FixedWriter, decodeFixed, encodeFixed, enumByte, exactBytes, fixedInstruction,
  nonzeroHash, readCeremonyEnvelope, ro, rs, rw, writeCeremonyEnvelope, ws,
} from "./release1FixedWire.js";
import { type ProposalGuardV3, readProposalGuardV3, writeProposalGuardV3 } from "./release1V3Instructions.js";

export const ADOPT_BUFFER_V2_TAG = 75;
export const VERIFY_BUFFER_CHUNK_V2_TAG = 76;
export const FINALIZE_BUFFER_VERIFICATION_V2_TAG = 77;
export const EXTEND_TARGET_V2_TAG = 78;
export const EXECUTE_UPGRADE_V2_TAG = 79;
export const CLOSE_ABANDONED_BUFFER_V2_TAG = 80;
export const ACTIVATE_ROLLBACK_V2_TAG = 81;
export const ADOPT_BUFFER_V2_LEN = 123;
export const VERIFY_BUFFER_CHUNK_V2_LEN = 421;
export const FINALIZE_BUFFER_VERIFICATION_V2_LEN = 224;
export const EXTEND_TARGET_V2_LEN = 385;
export const EXECUTE_UPGRADE_V2_LEN = 399;
export const CLOSE_ABANDONED_BUFFER_V2_LEN = 200;
export const ACTIVATE_ROLLBACK_V2_LEN = 410;
export const ARTIFACT_CHUNK_PROOF_V2_LEN = 225;
export const MAX_FIXED_MERKLE_PROOF_NODES_V1 = 7;
export const VERIFICATION_BITMAP_BYTES_V1 = 64;

type Digest = Buffer;
export interface ArtifactChunkProofV2 { proofLen: number; nodes: readonly Digest[] }
export interface AdoptBufferV2 { expected: ProposalGuardV3 }
export interface VerifyBufferChunkV2 { expected: ProposalGuardV3; chunkIndex: number; proof: ArtifactChunkProofV2; expectedVerificationStatus: BufferStatus; expectedVerifiedChunkBitmap: Buffer; expectedVerifiedChunkCount: number }
export interface FinalizeBufferVerificationV2 { expected: ProposalGuardV3; expectedVerificationStatus: BufferStatus; expectedVerifiedChunkBitmap: Buffer; expectedVerifiedChunkCount: number; expectedSealedBufferHeaderHash: Digest }
export interface ExtendTargetV2 { expected: ProposalGuardV3; expectedPrestateCheckpointDigest: Digest; expectedPrestateCheckpointGeneration: bigint; expectedObservationDigest: Digest; expectedObservationGeneration: bigint; expectedObservationRoot: Digest; expectedObservationFinalizedSlot: bigint; expectedCurrentCapacity: bigint; expectedExtensionDelta: bigint; expectedPostCapacity: bigint; expectedNextDeploymentGeneration: bigint; expectedNextDeploymentDigest: Digest; envelope: CeremonyEnvelopeV1 }
export interface ExecuteUpgradeV2 { expected: ProposalGuardV3; expectedPrestateCheckpointDigest: Digest; expectedPrestateCheckpointGeneration: bigint; expectedObservationDigest: Digest; expectedObservationGeneration: bigint; expectedObservationRoot: Digest; expectedObservationFinalizedSlot: bigint; expectedActualCapacity: bigint; expectedSealedBufferHeaderHash: Digest; expectedVerifiedChunkCount: number; expectedBufferVerificationStatus: BufferStatus; expectedCounterpartProposalDigest: Digest; expectedCounterpartBufferVerificationStatus: BufferStatus; envelope: CeremonyEnvelopeV1 }
export interface CloseAbandonedBufferV2 { expected: ProposalGuardV3; expectedVerificationStatus: BufferStatus; expectedVerifiedChunkBitmap: Buffer; expectedVerifiedChunkCount: number; expectedBufferVerificationFinalizedSlot: bigint }
export interface ActivateRollbackV2 { expectedPrimary: ProposalGuardV3; expectedRollback: ProposalGuardV3; expectedFailureEvidenceDigest: Digest; expectedPrimaryVerificationGeneration: bigint; expectedProgramdataObservationStateHash: Digest; expectedProgramdataObservationGeneration: bigint; expectedRollbackBufferVerificationStatus: BufferStatus; expectedRollbackVerifiedChunkBitmap: Buffer; expectedRollbackVerifiedChunkCount: number; expectedRollbackBufferFinalizedSlot: bigint; expectedNextGateEpoch: bigint }

const bufferStatus = (value: number): BufferStatus => enumByte(value, Object.values(BufferVerificationStatusV1) as number[], "bufferVerificationStatus");
const bitmap = (value: Buffer, field: string): Buffer => exactBytes(value, VERIFICATION_BITMAP_BYTES_V1, field);
const hash = (value: Digest, field: string): Digest => nonzeroHash(value, field);
const zero = Buffer.alloc(32);

function validateProof(value: ArtifactChunkProofV2): void {
  if (!Number.isSafeInteger(value.proofLen) || value.proofLen < 0 || value.proofLen > MAX_FIXED_MERKLE_PROOF_NODES_V1 || value.nodes.length !== MAX_FIXED_MERKLE_PROOF_NODES_V1) throw new Error("invalid fixed artifact proof geometry");
  value.nodes.forEach((node, index) => exactBytes(node, 32, `proof.nodes[${index}]`));
  if (value.nodes.slice(value.proofLen).some((node) => !node.equals(zero))) throw new Error("artifact proof has nonzero padding");
}
function writeProof(w: FixedWriter, value: ArtifactChunkProofV2): void { validateProof(value); w.byte(value.proofLen, "proofLen"); value.nodes.forEach((node, index) => w.bytes(node, 32, `nodes[${index}]`)); }
function readProof(r: FixedReader): ArtifactChunkProofV2 { const value = { proofLen: r.byte(), nodes: Array.from({ length: 7 }, () => r.bytes(32)) }; validateProof(value); return value; }

export const encodeAdoptBufferV2 = (v: AdoptBufferV2): Buffer => encodeFixed(ADOPT_BUFFER_V2_TAG, ADOPT_BUFFER_V2_LEN, (w) => writeProposalGuardV3(w, v.expected));
export const decodeAdoptBufferV2 = (data: Buffer): AdoptBufferV2 => decodeFixed(data, ADOPT_BUFFER_V2_TAG, ADOPT_BUFFER_V2_LEN, (r) => ({ expected: readProposalGuardV3(r) }), (v) => { const probe = new FixedWriter(); writeProposalGuardV3(probe, v.expected); });

export const encodeVerifyBufferChunkV2 = (v: VerifyBufferChunkV2): Buffer => encodeFixed(VERIFY_BUFFER_CHUNK_V2_TAG, VERIFY_BUFFER_CHUNK_V2_LEN, (w) => { writeProposalGuardV3(w, v.expected); w.u32(v.chunkIndex, "chunkIndex"); writeProof(w, v.proof); w.byte(bufferStatus(v.expectedVerificationStatus), "expectedVerificationStatus").bytes(bitmap(v.expectedVerifiedChunkBitmap, "expectedVerifiedChunkBitmap"), 64, "expectedVerifiedChunkBitmap").u32(v.expectedVerifiedChunkCount, "expectedVerifiedChunkCount"); });
export const decodeVerifyBufferChunkV2 = (data: Buffer): VerifyBufferChunkV2 => decodeFixed(data, VERIFY_BUFFER_CHUNK_V2_TAG, VERIFY_BUFFER_CHUNK_V2_LEN, (r) => ({ expected: readProposalGuardV3(r), chunkIndex: r.u32(), proof: readProof(r), expectedVerificationStatus: bufferStatus(r.byte()), expectedVerifiedChunkBitmap: r.bytes(64), expectedVerifiedChunkCount: r.u32() }), (v) => { validateProof(v.proof); bitmap(v.expectedVerifiedChunkBitmap, "expectedVerifiedChunkBitmap"); });

export const encodeFinalizeBufferVerificationV2 = (v: FinalizeBufferVerificationV2): Buffer => encodeFixed(FINALIZE_BUFFER_VERIFICATION_V2_TAG, FINALIZE_BUFFER_VERIFICATION_V2_LEN, (w) => { hash(v.expectedSealedBufferHeaderHash, "expectedSealedBufferHeaderHash"); writeProposalGuardV3(w, v.expected); w.byte(bufferStatus(v.expectedVerificationStatus), "expectedVerificationStatus").bytes(bitmap(v.expectedVerifiedChunkBitmap, "expectedVerifiedChunkBitmap"), 64, "expectedVerifiedChunkBitmap").u32(v.expectedVerifiedChunkCount, "expectedVerifiedChunkCount").bytes(v.expectedSealedBufferHeaderHash, 32, "expectedSealedBufferHeaderHash"); });
export const decodeFinalizeBufferVerificationV2 = (data: Buffer): FinalizeBufferVerificationV2 => decodeFixed(data, FINALIZE_BUFFER_VERIFICATION_V2_TAG, FINALIZE_BUFFER_VERIFICATION_V2_LEN, (r) => ({ expected: readProposalGuardV3(r), expectedVerificationStatus: bufferStatus(r.byte()), expectedVerifiedChunkBitmap: r.bytes(64), expectedVerifiedChunkCount: r.u32(), expectedSealedBufferHeaderHash: r.bytes(32) }), (v) => { bitmap(v.expectedVerifiedChunkBitmap, "expectedVerifiedChunkBitmap"); hash(v.expectedSealedBufferHeaderHash, "expectedSealedBufferHeaderHash"); });

function validateExtend(v: ExtendTargetV2): void {
  [v.expectedPrestateCheckpointDigest, v.expectedObservationDigest, v.expectedObservationRoot, v.expectedNextDeploymentDigest].forEach((x, i) => hash(x, `extend.hash[${i}]`));
  if (v.expectedPrestateCheckpointGeneration === 0n || v.expectedObservationGeneration === 0n || v.expectedObservationFinalizedSlot === 0n ||
    v.expectedCurrentCapacity === 0n || v.expectedExtensionDelta === 0n || v.expectedPostCapacity <= v.expectedCurrentCapacity ||
    v.expectedPostCapacity !== v.expectedCurrentCapacity + v.expectedExtensionDelta || v.expected.expectedCurrentDeploymentGeneration === 0xffff_ffff_ffff_ffffn ||
    v.expectedNextDeploymentGeneration !== v.expected.expectedCurrentDeploymentGeneration + 1n) throw new Error("invalid target extension transition");
}
export const encodeExtendTargetV2 = (v: ExtendTargetV2): Buffer => { validateExtend(v); return encodeFixed(EXTEND_TARGET_V2_TAG, EXTEND_TARGET_V2_LEN, (w) => { writeProposalGuardV3(w, v.expected); w.bytes(v.expectedPrestateCheckpointDigest, 32, "expectedPrestateCheckpointDigest").u64(v.expectedPrestateCheckpointGeneration, "expectedPrestateCheckpointGeneration").bytes(v.expectedObservationDigest, 32, "expectedObservationDigest").u64(v.expectedObservationGeneration, "expectedObservationGeneration").bytes(v.expectedObservationRoot, 32, "expectedObservationRoot").u64(v.expectedObservationFinalizedSlot, "expectedObservationFinalizedSlot").u64(v.expectedCurrentCapacity, "expectedCurrentCapacity").u64(v.expectedExtensionDelta, "expectedExtensionDelta").u64(v.expectedPostCapacity, "expectedPostCapacity").u64(v.expectedNextDeploymentGeneration, "expectedNextDeploymentGeneration").bytes(v.expectedNextDeploymentDigest, 32, "expectedNextDeploymentDigest"); writeCeremonyEnvelope(w, v.envelope); }); };
export const decodeExtendTargetV2 = (data: Buffer): ExtendTargetV2 => decodeFixed(data, EXTEND_TARGET_V2_TAG, EXTEND_TARGET_V2_LEN, (r) => ({ expected: readProposalGuardV3(r), expectedPrestateCheckpointDigest: r.bytes(32), expectedPrestateCheckpointGeneration: r.u64(), expectedObservationDigest: r.bytes(32), expectedObservationGeneration: r.u64(), expectedObservationRoot: r.bytes(32), expectedObservationFinalizedSlot: r.u64(), expectedCurrentCapacity: r.u64(), expectedExtensionDelta: r.u64(), expectedPostCapacity: r.u64(), expectedNextDeploymentGeneration: r.u64(), expectedNextDeploymentDigest: r.bytes(32), envelope: readCeremonyEnvelope(r) }), validateExtend);

function validateExecute(v: ExecuteUpgradeV2): void {
  [v.expectedPrestateCheckpointDigest, v.expectedObservationDigest, v.expectedObservationRoot, v.expectedSealedBufferHeaderHash, v.expectedCounterpartProposalDigest].forEach((x, i) => hash(x, `upgrade.hash[${i}]`));
  bufferStatus(v.expectedBufferVerificationStatus); bufferStatus(v.expectedCounterpartBufferVerificationStatus);
  if (v.expectedPrestateCheckpointGeneration === 0n || v.expectedObservationGeneration === 0n || v.expectedObservationFinalizedSlot === 0n ||
    v.expectedActualCapacity === 0n || v.expectedVerifiedChunkCount === 0 || v.expectedBufferVerificationStatus !== BufferVerificationStatusV1.Verified) throw new Error("invalid upgrade execution transition");
}
export const encodeExecuteUpgradeV2 = (v: ExecuteUpgradeV2): Buffer => { validateExecute(v); return encodeFixed(EXECUTE_UPGRADE_V2_TAG, EXECUTE_UPGRADE_V2_LEN, (w) => { writeProposalGuardV3(w, v.expected); w.bytes(v.expectedPrestateCheckpointDigest, 32, "expectedPrestateCheckpointDigest").u64(v.expectedPrestateCheckpointGeneration, "expectedPrestateCheckpointGeneration").bytes(v.expectedObservationDigest, 32, "expectedObservationDigest").u64(v.expectedObservationGeneration, "expectedObservationGeneration").bytes(v.expectedObservationRoot, 32, "expectedObservationRoot").u64(v.expectedObservationFinalizedSlot, "expectedObservationFinalizedSlot").u64(v.expectedActualCapacity, "expectedActualCapacity").bytes(v.expectedSealedBufferHeaderHash, 32, "expectedSealedBufferHeaderHash").u32(v.expectedVerifiedChunkCount, "expectedVerifiedChunkCount").byte(v.expectedBufferVerificationStatus, "expectedBufferVerificationStatus").bytes(v.expectedCounterpartProposalDigest, 32, "expectedCounterpartProposalDigest").byte(v.expectedCounterpartBufferVerificationStatus, "expectedCounterpartBufferVerificationStatus"); writeCeremonyEnvelope(w, v.envelope); }); };
export const decodeExecuteUpgradeV2 = (data: Buffer): ExecuteUpgradeV2 => decodeFixed(data, EXECUTE_UPGRADE_V2_TAG, EXECUTE_UPGRADE_V2_LEN, (r) => ({ expected: readProposalGuardV3(r), expectedPrestateCheckpointDigest: r.bytes(32), expectedPrestateCheckpointGeneration: r.u64(), expectedObservationDigest: r.bytes(32), expectedObservationGeneration: r.u64(), expectedObservationRoot: r.bytes(32), expectedObservationFinalizedSlot: r.u64(), expectedActualCapacity: r.u64(), expectedSealedBufferHeaderHash: r.bytes(32), expectedVerifiedChunkCount: r.u32(), expectedBufferVerificationStatus: bufferStatus(r.byte()), expectedCounterpartProposalDigest: r.bytes(32), expectedCounterpartBufferVerificationStatus: bufferStatus(r.byte()), envelope: readCeremonyEnvelope(r) }), validateExecute);

export const encodeCloseAbandonedBufferV2 = (v: CloseAbandonedBufferV2): Buffer => encodeFixed(CLOSE_ABANDONED_BUFFER_V2_TAG, CLOSE_ABANDONED_BUFFER_V2_LEN, (w) => { writeProposalGuardV3(w, v.expected); w.byte(bufferStatus(v.expectedVerificationStatus), "expectedVerificationStatus").bytes(bitmap(v.expectedVerifiedChunkBitmap, "expectedVerifiedChunkBitmap"), 64, "expectedVerifiedChunkBitmap").u32(v.expectedVerifiedChunkCount, "expectedVerifiedChunkCount").u64(v.expectedBufferVerificationFinalizedSlot, "expectedBufferVerificationFinalizedSlot"); });
export const decodeCloseAbandonedBufferV2 = (data: Buffer): CloseAbandonedBufferV2 => decodeFixed(data, CLOSE_ABANDONED_BUFFER_V2_TAG, CLOSE_ABANDONED_BUFFER_V2_LEN, (r) => ({ expected: readProposalGuardV3(r), expectedVerificationStatus: bufferStatus(r.byte()), expectedVerifiedChunkBitmap: r.bytes(64), expectedVerifiedChunkCount: r.u32(), expectedBufferVerificationFinalizedSlot: r.u64() }), (v) => { bitmap(v.expectedVerifiedChunkBitmap, "expectedVerifiedChunkBitmap"); });

function validateRollback(v: ActivateRollbackV2): void {
  hash(v.expectedFailureEvidenceDigest, "expectedFailureEvidenceDigest"); hash(v.expectedProgramdataObservationStateHash, "expectedProgramdataObservationStateHash");
  bufferStatus(v.expectedRollbackBufferVerificationStatus); bitmap(v.expectedRollbackVerifiedChunkBitmap, "expectedRollbackVerifiedChunkBitmap");
  if (v.expectedProgramdataObservationGeneration === 0n || v.expectedRollbackBufferVerificationStatus !== BufferVerificationStatusV1.Verified ||
    v.expectedRollbackVerifiedChunkCount === 0 || v.expectedRollbackBufferFinalizedSlot === 0n || v.expectedPrimary.expectedGateEpoch === 0xffff_ffff_ffff_ffffn ||
    v.expectedNextGateEpoch !== v.expectedPrimary.expectedGateEpoch + 1n) throw new Error("invalid rollback activation transition");
}
export const encodeActivateRollbackV2 = (v: ActivateRollbackV2): Buffer => { validateRollback(v); return encodeFixed(ACTIVATE_ROLLBACK_V2_TAG, ACTIVATE_ROLLBACK_V2_LEN, (w) => { writeProposalGuardV3(w, v.expectedPrimary); writeProposalGuardV3(w, v.expectedRollback); w.bytes(v.expectedFailureEvidenceDigest, 32, "expectedFailureEvidenceDigest").u64(v.expectedPrimaryVerificationGeneration, "expectedPrimaryVerificationGeneration").bytes(v.expectedProgramdataObservationStateHash, 32, "expectedProgramdataObservationStateHash").u64(v.expectedProgramdataObservationGeneration, "expectedProgramdataObservationGeneration").byte(v.expectedRollbackBufferVerificationStatus, "expectedRollbackBufferVerificationStatus").bytes(v.expectedRollbackVerifiedChunkBitmap, 64, "expectedRollbackVerifiedChunkBitmap").u32(v.expectedRollbackVerifiedChunkCount, "expectedRollbackVerifiedChunkCount").u64(v.expectedRollbackBufferFinalizedSlot, "expectedRollbackBufferFinalizedSlot").u64(v.expectedNextGateEpoch, "expectedNextGateEpoch"); }); };
export const decodeActivateRollbackV2 = (data: Buffer): ActivateRollbackV2 => decodeFixed(data, ACTIVATE_ROLLBACK_V2_TAG, ACTIVATE_ROLLBACK_V2_LEN, (r) => ({ expectedPrimary: readProposalGuardV3(r), expectedRollback: readProposalGuardV3(r), expectedFailureEvidenceDigest: r.bytes(32), expectedPrimaryVerificationGeneration: r.u64(), expectedProgramdataObservationStateHash: r.bytes(32), expectedProgramdataObservationGeneration: r.u64(), expectedRollbackBufferVerificationStatus: bufferStatus(r.byte()), expectedRollbackVerifiedChunkBitmap: r.bytes(64), expectedRollbackVerifiedChunkCount: r.u32(), expectedRollbackBufferFinalizedSlot: r.u64(), expectedNextGateEpoch: r.u64() }), validateRollback);

export type Release1V3CustodyInstruction = { tag: 75; value: AdoptBufferV2 } | { tag: 76; value: VerifyBufferChunkV2 } | { tag: 77; value: FinalizeBufferVerificationV2 } | { tag: 78; value: ExtendTargetV2 } | { tag: 79; value: ExecuteUpgradeV2 } | { tag: 80; value: CloseAbandonedBufferV2 } | { tag: 81; value: ActivateRollbackV2 };
export function decodeRelease1V3CustodyInstruction(data: Buffer): Release1V3CustodyInstruction {
  switch (data[0]) {
    case 75: return { tag: 75, value: decodeAdoptBufferV2(data) };
    case 76: return { tag: 76, value: decodeVerifyBufferChunkV2(data) };
    case 77: return { tag: 77, value: decodeFinalizeBufferVerificationV2(data) };
    case 78: return { tag: 78, value: decodeExtendTargetV2(data) };
    case 79: return { tag: 79, value: decodeExecuteUpgradeV2(data) };
    case 80: return { tag: 80, value: decodeCloseAbandonedBufferV2(data) };
    case 81: return { tag: 81, value: decodeActivateRollbackV2(data) };
    default: throw new Error("unknown Release 1 V3 custody instruction tag");
  }
}

export interface AdoptBufferV2Accounts { payer: PublicKey; controllerConfig: PublicKey; protocolGate: PublicKey; proposal: PublicKey; capacityPolicy: PublicKey; currentDeployment: PublicKey; buffer: PublicKey; uploaderAuthority: PublicKey; authorityPda: PublicKey; bufferVerification: PublicKey; upgradeableLoader: PublicKey; systemProgram: PublicKey }
export interface VerifyBufferChunkV2Accounts { controllerConfig: PublicKey; protocolGate: PublicKey; proposal: PublicKey; buffer: PublicKey; bufferVerification: PublicKey; authorityPda: PublicKey; upgradeableLoader: PublicKey }
export interface FinalizeBufferVerificationV2Accounts { controllerConfig: PublicKey; protocolGate: PublicKey; proposal: PublicKey; buffer: PublicKey; bufferVerification: PublicKey; authorityPda: PublicKey; upgradeableLoader: PublicKey }
export interface ExtendTargetV2Accounts { payer: PublicKey; controllerConfig: PublicKey; protocolGate: PublicKey; proposal: PublicKey; capacityPolicy: PublicKey; currentDeployment: PublicKey; programdataObservation: PublicKey; prestateCheckpoint: PublicKey; targetProgramdata: PublicKey; targetProgram: PublicKey; authorityPda: PublicKey; upgradeableLoader: PublicKey; systemProgram: PublicKey; rentSysvar: PublicKey; instructionsSysvar: PublicKey }
export interface ExecuteUpgradeV2Accounts { controllerConfig: PublicKey; policy: PublicKey; protocolGate: PublicKey; proposal: PublicKey; counterpartProposal: PublicKey; counterpartBufferVerification: PublicKey; capacityPolicy: PublicKey; currentDeployment: PublicKey; prestateProgramdataObservation: PublicKey; prestateCheckpoint: PublicKey; currentProgramdataObservation: PublicKey; bufferVerification: PublicKey; targetProgramdata: PublicKey; targetProgram: PublicKey; buffer: PublicKey; canonicalSpillTreasury: PublicKey; rentSysvar: PublicKey; clockSysvar: PublicKey; authorityPda: PublicKey; upgradeableLoader: PublicKey; instructionsSysvar: PublicKey }
export interface CloseAbandonedBufferV2Accounts { controllerConfig: PublicKey; protocolGate: PublicKey; proposal: PublicKey; bufferVerification: PublicKey; buffer: PublicKey; canonicalSpillTreasury: PublicKey; authorityPda: PublicKey; upgradeableLoader: PublicKey }
export interface ActivateRollbackV2Accounts { controllerConfig: PublicKey; policy: PublicKey; protocolGate: PublicKey; primaryProposal: PublicKey; rollbackProposal: PublicKey; rollbackBufferVerification: PublicKey; primaryProgramdataVerification: PublicKey; failureObservation: PublicKey; capacityPolicy: PublicKey; currentDeployment: PublicKey; programdataObservation: PublicKey; targetProgram: PublicKey; targetProgramdata: PublicKey; authorityPda: PublicKey; upgradeableLoader: PublicKey }

export const buildAdoptBufferV2Instruction = (p: PublicKey, a: AdoptBufferV2Accounts, v: AdoptBufferV2): TransactionInstruction => fixedInstruction(p, [ws(a.payer), ro(a.controllerConfig), ro(a.protocolGate), rw(a.proposal), ro(a.capacityPolicy), ro(a.currentDeployment), rw(a.buffer), rs(a.uploaderAuthority), ro(a.authorityPda), rw(a.bufferVerification), ro(a.upgradeableLoader), ro(a.systemProgram)], encodeAdoptBufferV2(v));
export const buildVerifyBufferChunkV2Instruction = (p: PublicKey, a: VerifyBufferChunkV2Accounts, v: VerifyBufferChunkV2): TransactionInstruction => fixedInstruction(p, [ro(a.controllerConfig), ro(a.protocolGate), ro(a.proposal), ro(a.buffer), rw(a.bufferVerification), ro(a.authorityPda), ro(a.upgradeableLoader)], encodeVerifyBufferChunkV2(v));
export const buildFinalizeBufferVerificationV2Instruction = (p: PublicKey, a: FinalizeBufferVerificationV2Accounts, v: FinalizeBufferVerificationV2): TransactionInstruction => fixedInstruction(p, [ro(a.controllerConfig), ro(a.protocolGate), rw(a.proposal), ro(a.buffer), rw(a.bufferVerification), ro(a.authorityPda), ro(a.upgradeableLoader)], encodeFinalizeBufferVerificationV2(v));
export const buildExtendTargetV2Instruction = (p: PublicKey, a: ExtendTargetV2Accounts, v: ExtendTargetV2): TransactionInstruction => fixedInstruction(p, [ws(a.payer), ro(a.controllerConfig), ro(a.protocolGate), rw(a.proposal), ro(a.capacityPolicy), rw(a.currentDeployment), ro(a.programdataObservation), ro(a.prestateCheckpoint), rw(a.targetProgramdata), rw(a.targetProgram), rw(a.authorityPda), ro(a.upgradeableLoader), ro(a.systemProgram), ro(a.rentSysvar), ro(a.instructionsSysvar)], encodeExtendTargetV2(v));
export const buildExecuteUpgradeV2Instruction = (p: PublicKey, a: ExecuteUpgradeV2Accounts, v: ExecuteUpgradeV2): TransactionInstruction => fixedInstruction(p, [ro(a.controllerConfig), ro(a.policy), ro(a.protocolGate), rw(a.proposal), ro(a.counterpartProposal), ro(a.counterpartBufferVerification), ro(a.capacityPolicy), ro(a.currentDeployment), ro(a.prestateProgramdataObservation), ro(a.prestateCheckpoint), ro(a.currentProgramdataObservation), rw(a.bufferVerification), rw(a.targetProgramdata), rw(a.targetProgram), rw(a.buffer), rw(a.canonicalSpillTreasury), ro(a.rentSysvar), ro(a.clockSysvar), ro(a.authorityPda), ro(a.upgradeableLoader), ro(a.instructionsSysvar)], encodeExecuteUpgradeV2(v));
export const buildCloseAbandonedBufferV2Instruction = (p: PublicKey, a: CloseAbandonedBufferV2Accounts, v: CloseAbandonedBufferV2): TransactionInstruction => fixedInstruction(p, [ro(a.controllerConfig), ro(a.protocolGate), ro(a.proposal), rw(a.bufferVerification), rw(a.buffer), rw(a.canonicalSpillTreasury), ro(a.authorityPda), ro(a.upgradeableLoader)], encodeCloseAbandonedBufferV2(v));
export const buildActivateRollbackV2Instruction = (p: PublicKey, a: ActivateRollbackV2Accounts, v: ActivateRollbackV2): TransactionInstruction => fixedInstruction(p, [ro(a.controllerConfig), ro(a.policy), rw(a.protocolGate), ro(a.primaryProposal), rw(a.rollbackProposal), ro(a.rollbackBufferVerification), ro(a.primaryProgramdataVerification), ro(a.failureObservation), ro(a.capacityPolicy), ro(a.currentDeployment), ro(a.programdataObservation), ro(a.targetProgram), ro(a.targetProgramdata), ro(a.authorityPda), ro(a.upgradeableLoader)], encodeActivateRollbackV2(v));
