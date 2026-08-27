import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  deserializeGovernanceInstructionTailV1,
  deserializeProtocolGateV1,
} from "../upgradeGovernance/v1.js";
import { syntheticSpreadGateBridgeV1 } from "../upgradeGovernance/spreadGateBridgeV1.js";

const SELF_HASH_PLACEHOLDER = "0".repeat(64);
const bridge = syntheticSpreadGateBridgeV1();
const decodedGate = deserializeProtocolGateV1(bridge.gateBytes);
const decodedTail = deserializeGovernanceInstructionTailV1(bridge.tailBytes);

const fixture = {
  schemaVersion: 1,
  warning:
    "SYNTHETIC NON-PRODUCTION BRIDGE VECTOR. The controller program is not assigned or deployed, and this file is not live governance state.",
  fixtureHashContract:
    "SHA-256 of this exact UTF-8, two-space-indented, LF-terminated JSON with fixtureSha256 replaced by 64 ASCII zeroes.",
  controllerProgram: bridge.controllerProgram.toBase58(),
  targetProgram: bridge.targetProgram.toBase58(),
  targetProgramdata: {
    address: bridge.targetProgramdata.toBase58(),
    bump: bridge.targetProgramdataBump,
    derivation: "Upgradeable Loader PDA with the target program public key as its sole seed",
  },
  pdas: {
    controllerConfig: {
      address: bridge.controllerConfig.toBase58(),
      bump: bridge.controllerConfigBump,
    },
    protocolGate: {
      address: bridge.gateAddress.toBase58(),
      bump: bridge.gateBump,
    },
  },
  gateAccount: {
    length: bridge.gateBytes.length,
    hex: bridge.gateBytes.toString("hex"),
    decoded: {
      discriminatorAscii: decodedGate.discriminator.toString("ascii"),
      accountVersion: decodedGate.accountVersion,
      bump: decodedGate.bump,
      initialized: decodedGate.initialized,
      status: decodedGate.status,
      statusName: "Active",
      controllerConfig: decodedGate.controllerConfig.toBase58(),
      targetProgram: decodedGate.targetProgram.toBase58(),
      targetProgramdata: decodedGate.targetProgramdata.toBase58(),
      epoch: decodedGate.epoch.toString(),
      activeProposal: decodedGate.activeProposal.toBase58(),
      freezeSlot: decodedGate.freezeSlot.toString(),
      freezeReasonCode: decodedGate.freezeReasonCode,
      lastCompletedProposal: decodedGate.lastCompletedProposal.toBase58(),
      reservedHex: decodedGate.reserved.toString("hex"),
    },
  },
  governanceTail: {
    length: bridge.tailBytes.length,
    hex: bridge.tailBytes.toString("hex"),
    decoded: {
      magicAscii: decodedTail.magic.toString("ascii"),
      version: decodedTail.version,
      reservedHex: decodedTail.reserved.toString("hex"),
      expectedEpoch: decodedTail.expectedEpoch.toString(),
    },
  },
  instructionBridge: {
    sampleOnly: true,
    sampleMeaning:
      "Byte-preservation vector only; ameba_gov does not classify the leading tag or claim this payload is executable by Spread.",
    legacyInstruction: {
      length: bridge.legacyInstruction.length,
      hex: bridge.legacyInstruction.toString("hex"),
    },
    envelopedInstruction: {
      length: bridge.envelopedInstruction.length,
      hex: bridge.envelopedInstruction.toString("hex"),
    },
    strippedLegacyInstruction: {
      length: bridge.strippedLegacyInstruction.length,
      hex: bridge.strippedLegacyInstruction.toString("hex"),
    },
    strippedMatchesLegacy: bridge.strippedLegacyInstruction.equals(
      bridge.legacyInstruction,
    ),
  },
  fixtureSha256: SELF_HASH_PLACEHOLDER,
};

function serialize(value: typeof fixture): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const placeholderBytes = serialize(fixture);
fixture.fixtureSha256 = createHash("sha256")
  .update(placeholderBytes, "utf8")
  .digest("hex");
const serialized = serialize(fixture);
const targetPath = fileURLToPath(
  new URL("../../../fixtures/spread_gate_bridge_v1.json", import.meta.url),
);

if (process.argv.includes("--check")) {
  if (readFileSync(targetPath, "utf8") !== serialized) {
    throw new Error(
      "frozen Spread gate bridge fixture is stale; run npm run generate:bridge",
    );
  }
} else {
  writeFileSync(targetPath, serialized, { encoding: "utf8" });
}
