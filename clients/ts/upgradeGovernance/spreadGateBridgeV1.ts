import { PublicKey } from "@solana/web3.js";
import {
  PROTOCOL_GATE_DISCRIMINATOR,
  canonicalGovernanceInstructionTailV1,
  deriveControllerConfigPda,
  deriveGatePda,
  deriveUpgradeableProgramdataAddress,
  envelopeInstructionDataV1,
  serializeGovernanceInstructionTailV1,
  serializeProtocolGateV1,
  stripGovernanceTailV1,
  type GovernanceInstructionTailV1Input,
  type ProtocolGateV1Input,
} from "./v1.js";

export const SYNTHETIC_CONTROLLER_PROGRAM_V1 = new PublicKey(
  "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi",
);
export const AMEBA_SPREAD_PROGRAM_V1 = new PublicKey(
  "9ipkBCjEfeJDMF6AFrezRmDDHmbnmeyv45cfXNqAnWsH",
);
export const SAMPLE_ACTIVE_GATE_EPOCH_V1 = 41n;

// This sample exists only to freeze suffix/strip behavior. ameba_gov does not
// classify the leading byte or claim the payload is executable by Spread.
export const SAMPLE_LEGACY_INSTRUCTION_V1 = Buffer.from(
  "cb0102030405060708",
  "hex",
);

export interface SyntheticSpreadGateBridgeV1 {
  controllerProgram: PublicKey;
  targetProgram: PublicKey;
  targetProgramdata: PublicKey;
  targetProgramdataBump: number;
  controllerConfig: PublicKey;
  controllerConfigBump: number;
  gateAddress: PublicKey;
  gateBump: number;
  gate: ProtocolGateV1Input;
  gateBytes: Buffer;
  tail: GovernanceInstructionTailV1Input;
  tailBytes: Buffer;
  legacyInstruction: Buffer;
  envelopedInstruction: Buffer;
  strippedLegacyInstruction: Buffer;
}

export function syntheticSpreadGateBridgeV1(): SyntheticSpreadGateBridgeV1 {
  const controllerProgram = SYNTHETIC_CONTROLLER_PROGRAM_V1;
  const targetProgram = AMEBA_SPREAD_PROGRAM_V1;
  const [targetProgramdata, targetProgramdataBump] =
    deriveUpgradeableProgramdataAddress(targetProgram);
  const [controllerConfig, controllerConfigBump] = deriveControllerConfigPda(
    controllerProgram,
    targetProgram,
  );
  const [gateAddress, gateBump] = deriveGatePda(
    controllerProgram,
    targetProgram,
  );
  const gate: ProtocolGateV1Input = {
    discriminator: Buffer.from(PROTOCOL_GATE_DISCRIMINATOR),
    accountVersion: 1,
    bump: gateBump,
    initialized: true,
    status: 0,
    controllerConfig,
    targetProgram,
    targetProgramdata,
    epoch: SAMPLE_ACTIVE_GATE_EPOCH_V1,
    activeProposal: PublicKey.default,
    freezeSlot: 0n,
    freezeReasonCode: 0,
    lastCompletedProposal: PublicKey.default,
    reserved: Buffer.alloc(2),
  };
  const gateBytes = serializeProtocolGateV1(gate);
  const tail = canonicalGovernanceInstructionTailV1(
    SAMPLE_ACTIVE_GATE_EPOCH_V1,
  );
  const tailBytes = serializeGovernanceInstructionTailV1(tail);
  const legacyInstruction = Buffer.from(SAMPLE_LEGACY_INSTRUCTION_V1);
  const envelopedInstruction = envelopeInstructionDataV1(
    legacyInstruction,
    tail,
  );
  const stripped = stripGovernanceTailV1(envelopedInstruction);

  return {
    controllerProgram,
    targetProgram,
    targetProgramdata,
    targetProgramdataBump,
    controllerConfig,
    controllerConfigBump,
    gateAddress,
    gateBump,
    gate,
    gateBytes,
    tail,
    tailBytes,
    legacyInstruction,
    envelopedInstruction,
    strippedLegacyInstruction: stripped.legacyInstruction,
  };
}
