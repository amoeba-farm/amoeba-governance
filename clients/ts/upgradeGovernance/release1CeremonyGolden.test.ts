import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";

import {
  bootstrapActivationProposalDigestV1,
  bootstrapActivationReceiptDigestV1,
  controllerImmutabilityReceiptDigestV1,
  controllerReleaseDigestV1,
  currentDeploymentDigestV1,
  deserializeBootstrapActivationProposalV1,
  deserializeBootstrapActivationReceiptV1,
  deserializeControllerImmutabilityReceiptV1,
  deserializeControllerReleaseCommitmentV1,
  deserializeCurrentDeploymentStateV1,
  deserializeProgramDataCapacityPolicyV1,
  deserializeProgramDataObservationV1,
  deserializeTargetAuthorityHandoffProposalV1,
  deserializeTargetAuthorityHandoffReceiptV1,
  deriveBootstrapActivationProposalPdaV1,
  deriveTargetAuthorityHandoffProposalPdaV1,
  programDataCapacityPolicyDigestV1,
  programDataObservationDigestV1,
  serializeBootstrapActivationProposalV1,
  serializeBootstrapActivationReceiptV1,
  serializeControllerImmutabilityReceiptV1,
  serializeControllerReleaseCommitmentV1,
  serializeCurrentDeploymentStateV1,
  serializeProgramDataCapacityPolicyV1,
  serializeProgramDataObservationV1,
  serializeTargetAuthorityHandoffProposalV1,
  serializeTargetAuthorityHandoffReceiptV1,
  targetAuthorityHandoffProposalDigestV1,
  targetAuthorityHandoffReceiptDigestV1,
  validateBootstrapActivationProposalDigestV1,
  validateBootstrapActivationReceiptDigestV1,
  validateControllerImmutabilityReceiptDigestV1,
  validateControllerReleaseDigestV1,
  validateCurrentDeploymentDigestV1,
  validateProgramDataCapacityPolicyDigestV1,
  validateProgramDataObservationDigestV1,
  validateTargetAuthorityHandoffProposalDigestV1,
  validateTargetAuthorityHandoffReceiptDigestV1,
} from "./release1Ceremony.js";

interface CeremonyEntry {
  account_type: string;
  length: number;
  discriminator_ascii: string;
  reserved_length: number;
  digest_hex: string;
  data_base64: string;
}

interface CeremonyFixture {
  fixture_version: number;
  proposal_pdas: {
    controller_program: string;
    target_program: string;
    council_version: number;
    target_authority_handoff_proposal: PdaVector;
    bootstrap_activation_proposal: PdaVector;
  };
  entries: CeremonyEntry[];
}

interface PdaVector {
  address: string;
  bump: number;
}

interface CodecCase {
  decode(data: Buffer): unknown;
  encode(value: unknown): Buffer;
  digest(value: unknown): Buffer;
  validate(value: unknown): void;
}

const fixture = JSON.parse(
  readFileSync(new URL("../../../fixtures/release1_ceremony_accounts_v1.json", import.meta.url), "utf8"),
) as CeremonyFixture;

const codecs: Readonly<Record<string, CodecCase>> = Object.freeze({
  ProgramDataCapacityPolicyV1: {
    decode: deserializeProgramDataCapacityPolicyV1,
    encode: (value) => serializeProgramDataCapacityPolicyV1(value as ReturnType<typeof deserializeProgramDataCapacityPolicyV1>),
    digest: (value) => programDataCapacityPolicyDigestV1(value as ReturnType<typeof deserializeProgramDataCapacityPolicyV1>),
    validate: (value) => validateProgramDataCapacityPolicyDigestV1(value as ReturnType<typeof deserializeProgramDataCapacityPolicyV1>),
  },
  ControllerReleaseCommitmentV1: {
    decode: deserializeControllerReleaseCommitmentV1,
    encode: (value) => serializeControllerReleaseCommitmentV1(value as ReturnType<typeof deserializeControllerReleaseCommitmentV1>),
    digest: (value) => controllerReleaseDigestV1(value as ReturnType<typeof deserializeControllerReleaseCommitmentV1>),
    validate: (value) => validateControllerReleaseDigestV1(value as ReturnType<typeof deserializeControllerReleaseCommitmentV1>),
  },
  ProgramDataObservationV1: {
    decode: deserializeProgramDataObservationV1,
    encode: (value) => serializeProgramDataObservationV1(value as ReturnType<typeof deserializeProgramDataObservationV1>),
    digest: (value) => programDataObservationDigestV1(value as ReturnType<typeof deserializeProgramDataObservationV1>),
    validate: (value) => validateProgramDataObservationDigestV1(value as ReturnType<typeof deserializeProgramDataObservationV1>),
  },
  CurrentDeploymentStateV1: {
    decode: deserializeCurrentDeploymentStateV1,
    encode: (value) => serializeCurrentDeploymentStateV1(value as ReturnType<typeof deserializeCurrentDeploymentStateV1>),
    digest: (value) => currentDeploymentDigestV1(value as ReturnType<typeof deserializeCurrentDeploymentStateV1>),
    validate: (value) => validateCurrentDeploymentDigestV1(value as ReturnType<typeof deserializeCurrentDeploymentStateV1>),
  },
  ControllerImmutabilityReceiptV1: {
    decode: deserializeControllerImmutabilityReceiptV1,
    encode: (value) => serializeControllerImmutabilityReceiptV1(value as ReturnType<typeof deserializeControllerImmutabilityReceiptV1>),
    digest: (value) => controllerImmutabilityReceiptDigestV1(value as ReturnType<typeof deserializeControllerImmutabilityReceiptV1>),
    validate: (value) => validateControllerImmutabilityReceiptDigestV1(value as ReturnType<typeof deserializeControllerImmutabilityReceiptV1>),
  },
  TargetAuthorityHandoffProposalV1: {
    decode: deserializeTargetAuthorityHandoffProposalV1,
    encode: (value) => serializeTargetAuthorityHandoffProposalV1(value as ReturnType<typeof deserializeTargetAuthorityHandoffProposalV1>),
    digest: (value) => targetAuthorityHandoffProposalDigestV1(value as ReturnType<typeof deserializeTargetAuthorityHandoffProposalV1>),
    validate: (value) => validateTargetAuthorityHandoffProposalDigestV1(value as ReturnType<typeof deserializeTargetAuthorityHandoffProposalV1>),
  },
  TargetAuthorityHandoffReceiptV1: {
    decode: deserializeTargetAuthorityHandoffReceiptV1,
    encode: (value) => serializeTargetAuthorityHandoffReceiptV1(value as ReturnType<typeof deserializeTargetAuthorityHandoffReceiptV1>),
    digest: (value) => targetAuthorityHandoffReceiptDigestV1(value as ReturnType<typeof deserializeTargetAuthorityHandoffReceiptV1>),
    validate: (value) => validateTargetAuthorityHandoffReceiptDigestV1(value as ReturnType<typeof deserializeTargetAuthorityHandoffReceiptV1>),
  },
  BootstrapActivationProposalV1: {
    decode: deserializeBootstrapActivationProposalV1,
    encode: (value) => serializeBootstrapActivationProposalV1(value as ReturnType<typeof deserializeBootstrapActivationProposalV1>),
    digest: (value) => bootstrapActivationProposalDigestV1(value as ReturnType<typeof deserializeBootstrapActivationProposalV1>),
    validate: (value) => validateBootstrapActivationProposalDigestV1(value as ReturnType<typeof deserializeBootstrapActivationProposalV1>),
  },
  BootstrapActivationReceiptV1: {
    decode: deserializeBootstrapActivationReceiptV1,
    encode: (value) => serializeBootstrapActivationReceiptV1(value as ReturnType<typeof deserializeBootstrapActivationReceiptV1>),
    digest: (value) => bootstrapActivationReceiptDigestV1(value as ReturnType<typeof deserializeBootstrapActivationReceiptV1>),
    validate: (value) => validateBootstrapActivationReceiptDigestV1(value as ReturnType<typeof deserializeBootstrapActivationReceiptV1>),
  },
});

test("nine ceremony accounts match the shared Rust/TypeScript golden bytes and digests", () => {
  assert.equal(fixture.fixture_version, 1);
  assert.equal(fixture.entries.length, 9);
  assert.equal(new Set(fixture.entries.map((entry) => entry.account_type)).size, 9);
  assert.deepEqual(Object.keys(codecs), fixture.entries.map((entry) => entry.account_type));

  const controller = new PublicKey(fixture.proposal_pdas.controller_program);
  const target = new PublicKey(fixture.proposal_pdas.target_program);
  const councilVersion = BigInt(fixture.proposal_pdas.council_version);
  const [handoffPda, handoffBump] = deriveTargetAuthorityHandoffProposalPdaV1(controller, target, councilVersion);
  const [activationPda, activationBump] = deriveBootstrapActivationProposalPdaV1(controller, target, councilVersion);
  assert.deepEqual(
    [handoffPda.toBase58(), handoffBump],
    [fixture.proposal_pdas.target_authority_handoff_proposal.address, fixture.proposal_pdas.target_authority_handoff_proposal.bump],
  );
  assert.deepEqual(
    [activationPda.toBase58(), activationBump],
    [fixture.proposal_pdas.bootstrap_activation_proposal.address, fixture.proposal_pdas.bootstrap_activation_proposal.bump],
  );

  for (const entry of fixture.entries) {
    const codec = codecs[entry.account_type];
    assert.ok(codec, `missing TypeScript codec for ${entry.account_type}`);
    const bytes = Buffer.from(entry.data_base64, "base64");
    assert.equal(bytes.length, entry.length, `${entry.account_type} length drifted`);
    assert.equal(bytes.subarray(0, 8).toString("ascii"), entry.discriminator_ascii, `${entry.account_type} discriminator drifted`);
    assert.ok(
      bytes.subarray(bytes.length - entry.reserved_length).every((byte) => byte === 0),
      `${entry.account_type} reserved bytes must all be zero`,
    );

    const decoded = codec.decode(bytes);
    assert.deepEqual(codec.encode(decoded), bytes, `${entry.account_type} TypeScript bytes drifted`);
    assert.equal(codec.digest(decoded).toString("hex"), entry.digest_hex, `${entry.account_type} TypeScript digest drifted`);
    codec.validate(decoded);

    if (entry.account_type === "TargetAuthorityHandoffProposalV1") {
      assert.equal((decoded as ReturnType<typeof deserializeTargetAuthorityHandoffProposalV1>).bump, handoffBump);
    } else if (entry.account_type === "TargetAuthorityHandoffReceiptV1") {
      assert.ok((decoded as ReturnType<typeof deserializeTargetAuthorityHandoffReceiptV1>).proposal.equals(handoffPda));
    } else if (entry.account_type === "BootstrapActivationProposalV1") {
      assert.equal((decoded as ReturnType<typeof deserializeBootstrapActivationProposalV1>).bump, activationBump);
    } else if (entry.account_type === "BootstrapActivationReceiptV1") {
      assert.ok((decoded as ReturnType<typeof deserializeBootstrapActivationReceiptV1>).proposal.equals(activationPda));
    }
  }
});
