import {
  type Release1InstructionV1,
  decodeRelease1InstructionV1,
} from "./release1LifecycleInstructions.js";
import {
  decodeAppendProgramDataObservationChunkV1,
  decodeBeginProgramDataObservationV1,
  decodeFinalizeProgramDataObservationV1,
  decodeVerifyObservedArtifactChunkV1,
  type AppendProgramDataObservationChunkV1,
  type BeginProgramDataObservationV1,
  type FinalizeProgramDataObservationV1,
  type VerifyObservedArtifactChunkV1,
} from "./release1CeremonyInstructions.js";
import { decodeRelease1AuthorityInstructionV1, type Release1AuthorityInstructionV1 } from "./release1AuthorityInstructions.js";
import { decodeRelease1V3Instruction, type Release1V3Instruction } from "./release1V3Instructions.js";
import { decodeRelease1V3CustodyInstruction, type Release1V3CustodyInstruction } from "./release1V3CustodyInstructions.js";
import {
  decodeRelease1GovernanceV2Instruction,
  type Release1GovernanceV2Instruction,
} from "./release1GovernanceV2.js";
import { MAX_RELEASE1_INSTRUCTION_DATA_LEN } from "./release1FixedWire.js";

export {
  CREATE_CANDIDATE_COUNCIL_SET_V1_TAG, CREATE_CANDIDATE_COUNCIL_SET_V1_LEN,
  CREATE_COUNCIL_ROTATION_V1_TAG, CREATE_COUNCIL_ROTATION_V1_LEN,
  APPROVE_COUNCIL_ROTATION_V1_TAG, APPROVE_COUNCIL_ROTATION_V1_LEN,
  ACTIVATE_COUNCIL_ROTATION_V1_TAG, ACTIVATE_COUNCIL_ROTATION_V1_LEN,
  QUEUE_COUNCIL_ROTATION_V1_TAG, QUEUE_COUNCIL_ROTATION_V1_LEN,
  CANCEL_COUNCIL_ROTATION_V1_TAG, CANCEL_COUNCIL_ROTATION_V1_LEN,
  EXPIRE_COUNCIL_ROTATION_V1_TAG, EXPIRE_COUNCIL_ROTATION_V1_LEN,
  encodeCreateCandidateCouncilSetV1, decodeCreateCandidateCouncilSetV1, buildCreateCandidateCouncilSetV1Instruction,
  encodeCreateCouncilRotationV1, decodeCreateCouncilRotationV1, buildCreateCouncilRotationV1Instruction,
  encodeApproveCouncilRotationV1, decodeApproveCouncilRotationV1, buildApproveCouncilRotationV1Instruction,
  encodeActivateCouncilRotationV1, decodeActivateCouncilRotationV1, buildActivateCouncilRotationV1Instruction,
  encodeQueueCouncilRotationV1, decodeQueueCouncilRotationV1, buildQueueCouncilRotationV1Instruction,
  encodeCancelCouncilRotationV1, decodeCancelCouncilRotationV1, buildCancelCouncilRotationV1Instruction,
  encodeExpireCouncilRotationV1, decodeExpireCouncilRotationV1, buildExpireCouncilRotationV1Instruction,
  type CreateCandidateCouncilSetV1, type CreateCandidateCouncilSetV1Accounts,
  type CreateCouncilRotationV1, type CreateCouncilRotationV1Accounts,
  type ApproveCouncilRotationV1, type ApproveCouncilRotationV1Accounts,
  type ActivateCouncilRotationV1, type ActivateCouncilRotationV1Accounts,
  type QueueCouncilRotationV1, type QueueCouncilRotationV1Accounts,
  type CancelCouncilRotationV1, type CancelCouncilRotationV1Accounts,
  type ExpireCouncilRotationV1, type ExpireCouncilRotationV1Accounts,
} from "./release1LifecycleInstructions.js";

export const CURRENT_RELEASE1_INSTRUCTION_TAGS = Object.freeze([
  18, 19, 20, 21, 22, 24, 25,
  39, 40, 41, 42, 43, 44, 45, 46, 47, 49, 50, 51, 52,
  53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66,
  67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81,
  82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95,
  96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107,
] as const);

type RetainedCouncilInstruction = Extract<Release1InstructionV1, { tag: 18 | 19 | 20 | 21 | 22 | 24 | 25 }>;
export type Release1ObservationInstructionV1 =
  | { tag: 39; value: BeginProgramDataObservationV1 }
  | { tag: 40; value: AppendProgramDataObservationChunkV1 }
  | { tag: 41; value: VerifyObservedArtifactChunkV1 }
  | { tag: 42; value: FinalizeProgramDataObservationV1 };
export type Release1GovernanceInstructionV2 = Release1GovernanceV2Instruction & { tag: number };
export type Release1CurrentInstruction = RetainedCouncilInstruction | Release1ObservationInstructionV1 |
  Release1AuthorityInstructionV1 | Release1V3Instruction | Release1V3CustodyInstruction |
  Release1GovernanceInstructionV2;

/** Decoder for the program's current dispatcher surface. Retired tags 0-17,
 * 23, 26-38, reserved tag 48, and all unknown tags fail generically. */
export function decodeRelease1CurrentInstruction(data: Buffer): Release1CurrentInstruction {
  if (!Buffer.isBuffer(data) || data.length === 0 || data.length > MAX_RELEASE1_INSTRUCTION_DATA_LEN) {
    throw new Error("invalid controller instruction length");
  }
  const tag = data[0]!;
  if (tag === 18 || tag === 19 || tag === 20 || tag === 21 || tag === 22 || tag === 24 || tag === 25) {
    return decodeRelease1InstructionV1(data) as RetainedCouncilInstruction;
  }
  switch (tag) {
    case 39: return { tag: 39, value: decodeBeginProgramDataObservationV1(data) };
    case 40: return { tag: 40, value: decodeAppendProgramDataObservationChunkV1(data) };
    case 41: return { tag: 41, value: decodeVerifyObservedArtifactChunkV1(data) };
    case 42: return { tag: 42, value: decodeFinalizeProgramDataObservationV1(data) };
  }
  if (tag >= 43 && tag <= 52 && tag !== 48) return decodeRelease1AuthorityInstructionV1(data);
  if (tag >= 53 && tag <= 74) return decodeRelease1V3Instruction(data);
  if (tag >= 75 && tag <= 81) return decodeRelease1V3CustodyInstruction(data);
  if (tag >= 82 && tag <= 107) return { tag, ...decodeRelease1GovernanceV2Instruction(data) };
  throw new Error("unknown or retired Release 1 instruction tag");
}
