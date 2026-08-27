import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import {
  GOVERNANCE_TAIL_V1_OFFSETS,
  PROTOCOL_GATE_V1_OFFSETS,
  canonicalGovernanceInstructionTailV1,
  deriveControllerConfigPda,
  deriveGatePda,
  deriveUpgradeableProgramdataAddress,
  deserializeGovernanceInstructionTailV1,
  deserializeProtocolGateV1,
  envelopeInstructionDataV1,
  serializeGovernanceInstructionTailV1,
  serializeProtocolGateV1,
  stripGovernanceTailV1,
} from "./v1.js";

interface PdaFixture {
  address: string;
  bump: number;
}

interface BridgeFixture {
  schemaVersion: number;
  warning: string;
  fixtureHashContract: string;
  fixtureSha256: string;
  controllerProgram: string;
  targetProgram: string;
  targetProgramdata: PdaFixture & { derivation: string };
  pdas: {
    controllerConfig: PdaFixture;
    protocolGate: PdaFixture;
  };
  gateAccount: {
    length: number;
    hex: string;
    decoded: {
      discriminatorAscii: string;
      accountVersion: number;
      bump: number;
      initialized: boolean;
      status: number;
      statusName: string;
      controllerConfig: string;
      targetProgram: string;
      targetProgramdata: string;
      epoch: string;
      activeProposal: string;
      freezeSlot: string;
      freezeReasonCode: number;
      lastCompletedProposal: string;
      reservedHex: string;
    };
  };
  governanceTail: {
    length: number;
    hex: string;
    decoded: {
      magicAscii: string;
      version: number;
      reservedHex: string;
      expectedEpoch: string;
    };
  };
  instructionBridge: {
    sampleOnly: boolean;
    legacyInstruction: { length: number; hex: string };
    envelopedInstruction: { length: number; hex: string };
    strippedLegacyInstruction: { length: number; hex: string };
    strippedMatchesLegacy: boolean;
  };
}

const fixtureText = readFileSync(
  new URL("../../../fixtures/spread_gate_bridge_v1.json", import.meta.url),
  "utf8",
);
const fixture = JSON.parse(fixtureText) as BridgeFixture;

function expectPda(actual: [PublicKey, number], expected: PdaFixture): void {
  assert.equal(actual[0].toBase58(), expected.address);
  assert.equal(actual[1], expected.bump);
}

test("Phase 3 fixture self-hash covers the exact placeholder-form file", () => {
  assert.equal(fixture.schemaVersion, 1);
  assert.match(fixture.warning, /SYNTHETIC NON-PRODUCTION/);
  assert.match(fixture.fixtureHashContract, /64 ASCII zeroes/);
  assert.match(fixture.fixtureSha256, /^[0-9a-f]{64}$/);

  const needle = `"fixtureSha256": "${fixture.fixtureSha256}"`;
  assert.equal(fixtureText.split(needle).length - 1, 1);
  const material = fixtureText.replace(
    needle,
    `"fixtureSha256": "${"0".repeat(64)}"`,
  );
  assert.equal(
    createHash("sha256").update(material, "utf8").digest("hex"),
    fixture.fixtureSha256,
  );
});

test("gate, ProgramData, config, and gate PDA vectors match exactly", () => {
  const controller = new PublicKey(fixture.controllerProgram);
  const target = new PublicKey(fixture.targetProgram);
  expectPda(
    deriveUpgradeableProgramdataAddress(target),
    fixture.targetProgramdata,
  );
  expectPda(
    deriveControllerConfigPda(controller, target),
    fixture.pdas.controllerConfig,
  );
  expectPda(deriveGatePda(controller, target), fixture.pdas.protocolGate);

  const bytes = Buffer.from(fixture.gateAccount.hex, "hex");
  assert.equal(bytes.length, 192);
  assert.equal(fixture.gateAccount.length, 192);
  const gate = deserializeProtocolGateV1(bytes);
  const decoded = fixture.gateAccount.decoded;
  assert.equal(gate.discriminator.toString("ascii"), decoded.discriminatorAscii);
  assert.equal(gate.accountVersion, decoded.accountVersion);
  assert.equal(gate.bump, decoded.bump);
  assert.equal(gate.initialized, decoded.initialized);
  assert.equal(gate.status, decoded.status);
  assert.equal(decoded.statusName, "Active");
  assert.equal(gate.controllerConfig.toBase58(), decoded.controllerConfig);
  assert.equal(gate.targetProgram.toBase58(), decoded.targetProgram);
  assert.equal(gate.targetProgramdata.toBase58(), decoded.targetProgramdata);
  assert.equal(gate.epoch.toString(), decoded.epoch);
  assert.equal(gate.activeProposal.toBase58(), decoded.activeProposal);
  assert.equal(gate.freezeSlot.toString(), decoded.freezeSlot);
  assert.equal(gate.freezeReasonCode, decoded.freezeReasonCode);
  assert.equal(
    gate.lastCompletedProposal.toBase58(),
    decoded.lastCompletedProposal,
  );
  assert.equal(gate.reserved.toString("hex"), decoded.reservedHex);
  assert.deepEqual(serializeProtocolGateV1(gate), bytes);
});

test("tail and instruction envelope freeze exact epoch-41 bytes", () => {
  const tailBytes = Buffer.from(fixture.governanceTail.hex, "hex");
  assert.equal(tailBytes.length, 16);
  assert.equal(fixture.governanceTail.length, 16);
  assert.equal(tailBytes.toString("hex"), "41475631010000002900000000000000");
  const tail = deserializeGovernanceInstructionTailV1(tailBytes);
  assert.equal(tail.magic.toString("ascii"), "AGV1");
  assert.equal(tail.version, 1);
  assert.equal(tail.reserved.toString("hex"), "000000");
  assert.equal(tail.expectedEpoch, 41n);
  assert.deepEqual(serializeGovernanceInstructionTailV1(tail), tailBytes);

  const legacy = Buffer.from(fixture.instructionBridge.legacyInstruction.hex, "hex");
  const enveloped = Buffer.from(
    fixture.instructionBridge.envelopedInstruction.hex,
    "hex",
  );
  const strippedExpected = Buffer.from(
    fixture.instructionBridge.strippedLegacyInstruction.hex,
    "hex",
  );
  assert.deepEqual(envelopeInstructionDataV1(legacy, tail), enveloped);
  const stripped = stripGovernanceTailV1(enveloped);
  assert.deepEqual(stripped.legacyInstruction, strippedExpected);
  assert.deepEqual(stripped.legacyInstruction, legacy);
  assert.deepEqual(stripped.tail, tail);
  assert.equal(fixture.instructionBridge.strippedMatchesLegacy, true);
});

test("gate and tail field offsets are frozen", () => {
  assert.deepEqual(PROTOCOL_GATE_V1_OFFSETS, {
    discriminator: 0,
    accountVersion: 8,
    bump: 9,
    initialized: 10,
    status: 11,
    controllerConfig: 12,
    targetProgram: 44,
    targetProgramdata: 76,
    epoch: 108,
    activeProposal: 116,
    freezeSlot: 148,
    freezeReasonCode: 156,
    lastCompletedProposal: 158,
    reserved: 190,
  });
  assert.deepEqual(GOVERNANCE_TAIL_V1_OFFSETS, {
    magic: 0,
    version: 4,
    reserved: 5,
    expectedEpoch: 8,
  });
});

test("gate decoder rejects size, discriminator, version, bool, enum, identity, and reserved drift", () => {
  const canonical = Buffer.from(fixture.gateAccount.hex, "hex");
  assert.throws(
    () => deserializeProtocolGateV1(canonical.subarray(0, 191)),
    /192 bytes/,
  );
  assert.throws(
    () => deserializeProtocolGateV1(Buffer.concat([canonical, Buffer.alloc(1)])),
    /192 bytes/,
  );

  for (const [offset, value] of [
    [PROTOCOL_GATE_V1_OFFSETS.discriminator, "X".charCodeAt(0)],
    [PROTOCOL_GATE_V1_OFFSETS.accountVersion, 2],
    [PROTOCOL_GATE_V1_OFFSETS.initialized, 0],
    [PROTOCOL_GATE_V1_OFFSETS.initialized, 2],
    [PROTOCOL_GATE_V1_OFFSETS.status, 3],
    [PROTOCOL_GATE_V1_OFFSETS.reserved, 1],
  ] as const) {
    const mutated = Buffer.from(canonical);
    mutated[offset] = value;
    assert.throws(() => deserializeProtocolGateV1(mutated));
  }

  for (const offset of [
    PROTOCOL_GATE_V1_OFFSETS.controllerConfig,
    PROTOCOL_GATE_V1_OFFSETS.targetProgram,
    PROTOCOL_GATE_V1_OFFSETS.targetProgramdata,
  ]) {
    const mutated = Buffer.from(canonical);
    mutated.fill(0, offset, offset + 32);
    assert.throws(() => deserializeProtocolGateV1(mutated), /nondefault/);
  }
});

test("tail parser is exact and never searches backward for magic", () => {
  const canonical = serializeGovernanceInstructionTailV1(
    canonicalGovernanceInstructionTailV1(41n),
  );
  assert.throws(
    () => deserializeGovernanceInstructionTailV1(canonical.subarray(0, 15)),
    /16 bytes/,
  );
  assert.throws(
    () =>
      deserializeGovernanceInstructionTailV1(
        Buffer.concat([canonical, Buffer.alloc(1)]),
      ),
    /16 bytes/,
  );
  for (const [offset, value] of [
    [GOVERNANCE_TAIL_V1_OFFSETS.magic, "X".charCodeAt(0)],
    [GOVERNANCE_TAIL_V1_OFFSETS.version, 2],
    [GOVERNANCE_TAIL_V1_OFFSETS.reserved, 1],
  ] as const) {
    const mutated = Buffer.from(canonical);
    mutated[offset] = value;
    assert.throws(() => deserializeGovernanceInstructionTailV1(mutated));
  }
  assert.throws(() => stripGovernanceTailV1(Buffer.from("prefixAGV1but-not-a-final-tail")));
});
