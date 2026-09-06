import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import {
  DEFAULT_TIMING_V3,
  deriveConfigV3,
  deriveProposalV3,
  proposalDigestV3,
  validateTimingV3,
  encodeActionV3,
  initializeV3,
  decodeProposalV3,
  type ProposalV3,
  DEVNET_SPREAD_V3,
  executeSpreadLightConfigV3,
  deriveSpreadLightConfigV3,
  deriveTargetAuthorityV3,
} from "./governanceV3.js";

const key = (byte: number) => new PublicKey(Buffer.alloc(32, byte));
const program = key(31);
const proposal: ProposalV3 = {
  bump: deriveProposalV3(program, 1n)[1],
  config: deriveConfigV3(program)[0],
  id: 1n,
  councilEpoch: 1n,
  timingVersion: 1n,
  timing: DEFAULT_TIMING_V3,
  created: 100n,
  reviewEnd: 1_512_100n,
  notBefore: 4_600n,
  expires: 2_592_100n,
  action: { kind: "setTiming", timing: DEFAULT_TIMING_V3 },
  digest: Buffer.alloc(32),
  approvals: 0,
  approvalCount: 0,
  cancellations: 0,
  cancellationCount: 0,
  state: 0,
  verifiedChunks: Buffer.alloc(12),
  verifiedCount: 0,
  extensionSlot: 0n,
  extendedCapacity: 0n,
  executedSlot: 0n,
};

test("one-week floor and fixed Devnet proposal vector match Rust", () => {
  assert.throws(() =>
    validateTimingV3({ ...DEFAULT_TIMING_V3, reviewSlots: 450n }),
  );
  assert.equal(encodeActionV3(proposal.action).length, 193);
  const digest = proposalDigestV3(program, proposal);
  assert.equal(
    digest.toString("hex"),
    "f41ce0bf8ebdcb6cf394653f7f0b3252925d4bd1ca80d8ccd16298f2d756ad6b",
  );
  const u64 = (n: bigint) => {
    const out = Buffer.alloc(8);
    out.writeBigUInt64LE(n);
    return out;
  };
  const bytes = Buffer.concat([
    Buffer.from("AG3PRP01"),
    Buffer.from([1, proposal.bump, 1]),
    proposal.config.toBuffer(),
    ...[
      1n,
      1n,
      1n,
      1_512_000n,
      4_500n,
      2_592_000n,
      100n,
      1_512_100n,
      4_600n,
      2_592_100n,
    ].map(u64),
    encodeActionV3(proposal.action),
    digest,
    Buffer.alloc(5 + 12 + 4 + 8 + 8 + 8 + 7),
  ]);
  assert.equal(bytes.length, 400);
  assert.equal(
    decodeProposalV3(program, deriveProposalV3(program, 1n)[0], bytes)
      .reviewEnd,
    1_512_100n,
  );
  bytes[100] ^= 1;
  assert.throws(() =>
    decodeProposalV3(program, deriveProposalV3(program, 1n)[0], bytes),
  );
});

test("Light initialization commits a fixed policy and only the canonical accounts", () => {
  const action = {
    kind: "initializeSpreadLightConfig" as const,
    target: DEVNET_SPREAD_V3, expectedEpoch: 3n, deployedSlot: 10n,
    compressionAuthority: key(42),
    rent: { baseRent: 123, compressionCost: 456, lamportsPerBytePerEpoch: 7, maxFundedEpochs: 8, maxTopUp: 901 },
    writeTopUp: 2345, addressTree: key(43),
  };
  const bytes = encodeActionV3(action);
  assert.equal(bytes.toString("hex"),
    "05" + "19be32910fa4baff9549fd4eb1e2011c3912fc26d95777f7b9a71146a8fa5726" +
    "03000000000000000a00000000000000" + "2a".repeat(32) +
    "7b00c8010708850329090000" + "2b".repeat(32) + "00".repeat(68));
  const p = { ...proposal, action };
  p.digest = proposalDigestV3(program, p);
  const ix = executeSpreadLightConfigV3(program, p, key(30));
  assert.equal(ix.data.toString("hex"), "0f" + p.digest.toString("hex"));
  assert.equal(ix.keys.length, 10);
  assert.deepEqual(ix.keys.map(k => [k.isSigner, k.isWritable]), [
    [true, true], [false, false], [false, true], [false, false], [false, false],
    [false, false], [false, false], [false, true], [false, false], [false, false],
  ]);
  assert(ix.keys[6]!.pubkey.equals(deriveTargetAuthorityV3(program, DEVNET_SPREAD_V3)[0]));
  assert(ix.keys[7]!.pubkey.equals(deriveSpreadLightConfigV3()[0]));
  for (const patch of [{ target: key(9) }, { expectedEpoch: 0n }, { deployedSlot: -1n },
    { compressionAuthority: PublicKey.default }, { addressTree: PublicKey.default }, { writeTopUp: 2 ** 32 },
    { rent: { ...action.rent, maxTopUp: 65536 } }]) {
    assert.throws(() => encodeActionV3({ ...action, ...patch }));
  }
  assert.throws(() => executeSpreadLightConfigV3(program, proposal, key(30)));
  const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };
  const account = Buffer.concat([
    Buffer.from("AG3PRP01"), Buffer.from([1, p.bump, 1]), p.config.toBuffer(),
    ...[p.id, p.councilEpoch, p.timingVersion, p.timing.reviewSlots, p.timing.delaySlots,
      p.timing.expirySlots, p.created, p.reviewEnd, p.notBefore, p.expires].map(u64),
    bytes, p.digest, Buffer.alloc(5 + 12 + 4 + 8 + 8 + 8 + 7),
  ]);
  assert.deepEqual(decodeProposalV3(program, deriveProposalV3(program, 1n)[0], account).action, action);
  account[123 + 125] = 1;
  assert.throws(() => decodeProposalV3(program, deriveProposalV3(program, 1n)[0], account));
});

test("bootstrap requires distinct council consents and blocks weak policy", () => {
  const seats = [40, 41, 42, 43, 44].map(key);
  const ix = initializeV3(
    program,
    key(30),
    key(29),
    seats,
    key(32),
    seats.slice(0, 3),
  );
  assert.equal(ix.data.length, 193);
  assert.equal(ix.keys.filter((x) => x.isSigner).length, 5);
  assert.throws(() =>
    initializeV3(program, key(30), key(29), seats, key(32), [
      seats[0]!,
      seats[0]!,
      seats[1]!,
    ]),
  );
  assert.throws(() =>
    encodeActionV3({
      kind: "setTiming",
      timing: { ...DEFAULT_TIMING_V3, reviewSlots: 450n },
    }),
  );
});
