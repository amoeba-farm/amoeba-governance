import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  RELEASE1_TRANSACTION_PACKET_LIMIT_V1,
  Release1PacketLimitError,
  assertRelease1PacketSizeV1,
} from "./release1PacketPlanning.js";
import { encodeInitializeControllerV2, type InitializeControllerV2 } from "./release1V3Instructions.js";
import { buildInitializeControllerV2Instruction } from "./release1V3Builders.js";

const INITIALIZE_CONTROLLER_V2_TAG = 53;
const INITIALIZE_CONTROLLER_V2_PAYLOAD_LEN = 632;
const INITIALIZE_CONTROLLER_V2_ACCOUNT_COUNT = 22;
const U64_MAX = 0xffff_ffff_ffff_ffffn;

function digest(label: string): Buffer {
  return createHash("sha256").update(label, "utf8").digest();
}

function key(label: string): PublicKey {
  return new PublicKey(digest(`initialize-controller-v2:${label}`));
}

function u64(value: bigint): Buffer {
  const encoded = Buffer.alloc(8);
  encoded.writeBigUInt64LE(value);
  return encoded;
}

/** Test-local encoding of the current Rust-authoritative tag-53 payload. This
 * intentionally is not exported as a public V3 constructor while that ABI is
 * still stabilizing. */
function rustAuthoritativeInitializeControllerV2Data(): Buffer {
  const policy = [
    1n, // initial_policy_version
    1n, // initial_council_version
    1n, // next_proposal_id
    1n, // target_nonce
    1n, // initial_gate_epoch
    1_000n, // policy_activation_slot
    10n, // routine_delay_slots
    20n, // major_delay_slots
    5n, // rollback_delay_slots
    30n, // terminal_delay_slots
    7n, // vote_review_slots
    100n, // proposal_expiry_slots
  ].map(u64);
  const seatTerms = Array.from({ length: 5 }, (_, index) =>
    Buffer.concat([u64(BigInt(1_000 + index)), u64(U64_MAX)]),
  );
  const controllerRelease = Buffer.concat([
    u64(1_100_003n),
    ...[
      "artifact-sha256",
      "artifact-merkle-root",
      "source-commitment",
      "source-tree-commitment",
      "build-inputs-commitment",
      "toolchain-commitment",
      "package-commitment",
      "release-manifest-commitment",
      "abi-commitment",
      "expected-release-digest",
    ].map((label) => digest(label)),
  ]);
  const payload = Buffer.concat([
    digest("cluster-domain"),
    ...policy,
    digest("expected-policy-hash"),
    digest("expected-council-hash"),
    ...seatTerms,
    digest("expected-capacity-policy-digest"),
    controllerRelease,
  ]);
  assert.equal(payload.length, INITIALIZE_CONTROLLER_V2_PAYLOAD_LEN);
  return Buffer.concat([Buffer.from([INITIALIZE_CONTROLLER_V2_TAG]), payload]);
}

const initializeValue: InitializeControllerV2 = {
  clusterDomain: digest("cluster-domain"),
  initialPolicyVersion: 1n,
  initialCouncilVersion: 1n,
  nextProposalId: 1n,
  targetNonce: 1n,
  initialGateEpoch: 1n,
  policyActivationSlot: 1_000n,
  routineDelaySlots: 10n,
  majorDelaySlots: 20n,
  rollbackDelaySlots: 5n,
  terminalDelaySlots: 30n,
  voteReviewSlots: 7n,
  proposalExpirySlots: 100n,
  expectedPolicyHash: digest("expected-policy-hash"),
  expectedCouncilHash: digest("expected-council-hash"),
  seatTerms: Array.from({ length: 5 }, (_, index) => ({ termStartSlot: BigInt(1_000 + index), termEndSlot: U64_MAX })),
  capacityPolicy: { expectedPolicyDigest: digest("expected-capacity-policy-digest") },
  controllerRelease: {
    artifactLength: 1_100_003n,
    artifactSha256: digest("artifact-sha256"),
    artifactMerkleRoot: digest("artifact-merkle-root"),
    sourceCommitment: digest("source-commitment"),
    sourceTreeCommitment: digest("source-tree-commitment"),
    buildInputsCommitment: digest("build-inputs-commitment"),
    toolchainCommitment: digest("toolchain-commitment"),
    packageCommitment: digest("package-commitment"),
    releaseManifestCommitment: digest("release-manifest-commitment"),
    abiCommitment: digest("abi-commitment"),
    expectedReleaseDigest: digest("expected-release-digest"),
  },
};

const payer = key("payer");
const initializer = key("initializer");
const controllerProgram = key("controller-program");
const controllerProgramdata = key("controller-programdata");
const targetProgram = key("target-program");
const targetProgramdata = key("target-programdata");
const upgradeableLoader = key("upgradeable-loader");
const controllerConfig = key("controller-config");
const authorityPda = key("authority-pda");
const protocolGate = key("protocol-gate");
const policy = key("policy");
const council = key("council");
const capacityPolicy = key("capacity-policy");
const controllerRelease = key("controller-release");
const canonicalSpillTreasury = key("canonical-spill-treasury");
const guardian = key("guardian");
const seatAuthorities = Array.from({ length: 5 }, (_, index) => key(`seat-${index}`));

function initializeControllerV2Instruction(): TransactionInstruction {
  return buildInitializeControllerV2Instruction(controllerProgram, {
    payer, initializer, controllerProgram, controllerProgramdata, targetProgram, targetProgramdata,
    upgradeableLoader, controllerConfig, authorityPda, protocolGate, policy, council, capacityPolicy,
    controllerRelease, canonicalSpillTreasury, guardian, seatAuthorities, systemProgram: SystemProgram.programId,
  }, initializeValue);
}

const lookupCandidates = [
  controllerProgramdata,
  targetProgram,
  targetProgramdata,
  upgradeableLoader,
  controllerConfig,
  authorityPda,
  protocolGate,
  policy,
  council,
  capacityPolicy,
  controllerRelease,
  canonicalSpillTreasury,
  guardian,
] as const;

function lookupTable(addresses: readonly PublicKey[]): AddressLookupTableAccount {
  return new AddressLookupTableAccount({
    key: key(`lookup-table-${addresses.length}`),
    state: {
      deactivationSlot: U64_MAX,
      lastExtendedSlot: 900,
      lastExtendedSlotStartIndex: 0,
      authority: key("lookup-authority"),
      addresses: [...addresses],
    },
  });
}

function packet(addresses: readonly PublicKey[]): {
  readonly bytes: number;
  readonly signatures: number;
  readonly lookedUp: number;
  readonly sha256: string;
} {
  const instruction = initializeControllerV2Instruction();
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: key("recent-blockhash").toBase58(),
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000_000n }),
      instruction,
    ],
  }).compileToV0Message([lookupTable(addresses)]);
  const wireBytes = Buffer.from(new VersionedTransaction(message).serialize());
  return {
    bytes: wireBytes.length,
    signatures: message.header.numRequiredSignatures,
    lookedUp: message.addressTableLookups.reduce(
      (count, lookup) => count + lookup.writableIndexes.length + lookup.readonlyIndexes.length,
      0,
    ),
    sha256: createHash("sha256").update(wireBytes).digest("hex"),
  };
}

test("InitializeControllerV2 fits only with at least thirteen looked-up nonsigners", () => {
  const instruction = initializeControllerV2Instruction();
  assert.deepEqual(encodeInitializeControllerV2(initializeValue), rustAuthoritativeInitializeControllerV2Data());
  assert.equal(instruction.data.length, 1 + INITIALIZE_CONTROLLER_V2_PAYLOAD_LEN);
  assert.equal(instruction.data[0], INITIALIZE_CONTROLLER_V2_TAG);
  assert.equal(instruction.keys.length, INITIALIZE_CONTROLLER_V2_ACCOUNT_COUNT);
  assert.equal(instruction.keys.filter((meta) => meta.isSigner).length, 2);

  const thirteen = packet(lookupCandidates);
  assert.deepEqual(thirteen, {
    bytes: 1_214,
    signatures: 2,
    lookedUp: 13,
    sha256: "15630355bf6e2966841330b5d928f3d6726994b8b9ecb40e0decc4084e771896",
  });
  assert.ok(thirteen.bytes <= RELEASE1_TRANSACTION_PACKET_LIMIT_V1);
  assert.doesNotThrow(() => assertRelease1PacketSizeV1(thirteen.bytes));

  const twelve = packet(lookupCandidates.slice(0, 12));
  assert.deepEqual(twelve, {
    bytes: 1_245,
    signatures: 2,
    lookedUp: 12,
    sha256: "d89065262c42505b1ee71915799fc51de2a042df77b50b8d89692bdcd2b748a2",
  });
  assert.ok(twelve.bytes > RELEASE1_TRANSACTION_PACKET_LIMIT_V1);
  assert.throws(
    () => assertRelease1PacketSizeV1(twelve.bytes),
    (error: unknown) => error instanceof Release1PacketLimitError
      && error.packetBytes === twelve.bytes,
  );
});
