/** Fresh Devnet controller. These builders hold no keys and submit no transactions. */
import { createHash } from "node:crypto";
import {
  AccountMeta,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
export const GOVERNANCE_V3_GENESIS =
  "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const GOVERNANCE_V3_DOMAIN = Buffer.from("ameba-governance-v3");
export const WEEK_SLOTS_V3 = 1_512_000n;
export const LOADER_V3 = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
export const CONFIG_V3_LEN = 384;
export const PROPOSAL_V3_LEN = 400;
export interface TimingV3 {
  reviewSlots: bigint;
  delaySlots: bigint;
  expirySlots: bigint;
}
export const DEFAULT_TIMING_V3: Readonly<TimingV3> = Object.freeze({
  reviewSlots: WEEK_SLOTS_V3,
  delaySlots: 4_500n,
  expirySlots: 2_592_000n,
});
export interface ConfigV3 {
  bump: number;
  controller: PublicKey;
  programdata: PublicKey;
  authority: PublicKey;
  treasury: PublicKey;
  seats: PublicKey[];
  councilEpoch: bigint;
  timingVersion: bigint;
  timing: TimingV3;
  nextId: bigint;
}
export type ActionV3 =
  | {
      kind: "upgradeController";
      buffer: PublicKey;
      artifactLength: bigint;
      artifactSha256: Uint8Array;
      merkleRoot: Uint8Array;
      deployedSlot: bigint;
      capacity: bigint;
      sourceCommitment: Uint8Array;
      buildCommitment: Uint8Array;
    }
  | { kind: "setTiming"; timing: TimingV3 }
  | { kind: "rotateCouncil"; seats: PublicKey[] }
  | {
      kind: "upgradeTarget";
      buffer: PublicKey;
      artifactLength: bigint;
      merkleRoot: Uint8Array;
      deployedSlot: bigint;
      capacity: bigint;
      sourceCommitment: Uint8Array;
      buildCommitment: Uint8Array;
      target: PublicKey;
      gateEpoch: bigint;
    }
  | {
      kind: "setTargetGate";
      target: PublicKey;
      expectedEpoch: bigint;
      active: boolean;
    };
export interface ProposalV3 {
  bump: number;
  config: PublicKey;
  id: bigint;
  councilEpoch: bigint;
  timingVersion: bigint;
  timing: TimingV3;
  created: bigint;
  reviewEnd: bigint;
  notBefore: bigint;
  expires: bigint;
  action: ActionV3;
  digest: Buffer;
  approvals: number;
  approvalCount: number;
  cancellations: number;
  cancellationCount: number;
  state: number;
  verifiedChunks: Buffer;
  verifiedCount: number;
  extensionSlot: bigint;
  extendedCapacity: bigint;
  executedSlot: bigint;
}
const check = (ok: boolean, message: string): void => {
  if (!ok) throw Error(message);
};
const zero = (value: Uint8Array) => value.every((x) => x === 0);
function u64(value: bigint): Buffer {
  check(
    typeof value === "bigint" && value >= 0n && value <= 0xffffffffffffffffn,
    "u64 out of range",
  );
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(value);
  return bytes;
}
function hash32(value: Uint8Array): Buffer {
  check(value.length === 32 && !zero(value), "nonzero bytes32 required");
  return Buffer.from(value);
}
export function validateTimingV3(timing: TimingV3): void {
  for (const value of [
    timing.reviewSlots,
    timing.delaySlots,
    timing.expirySlots,
  ])
    u64(value);
  check(
    timing.reviewSlots >= WEEK_SLOTS_V3 && timing.delaySlots >= 4_500n,
    "approval needs at least one week and delay at least 4500 slots",
  );
  const maximum =
    timing.reviewSlots > timing.delaySlots
      ? timing.reviewSlots
      : timing.delaySlots;
  check(
    timing.expirySlots > maximum + 9_000n,
    "expiry must retain the execution margin",
  );
}
function timingBytes(timing: TimingV3): Buffer {
  validateTimingV3(timing);
  return Buffer.concat([
    u64(timing.reviewSlots),
    u64(timing.delaySlots),
    u64(timing.expirySlots),
  ]);
}
function seatsBytes(seats: PublicKey[]): Buffer {
  check(
    seats.length === 5 &&
      new Set(seats.map((x) => x.toBase58())).size === 5 &&
      seats.every((x) => !x.equals(PublicKey.default)),
    "five distinct nonzero seats required",
  );
  return Buffer.concat(seats.map((x) => x.toBuffer()));
}
export const deriveConfigV3 = (program: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [GOVERNANCE_V3_DOMAIN, Buffer.from("council")],
    program,
  );
export const deriveAuthorityV3 = (program: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [GOVERNANCE_V3_DOMAIN, Buffer.from("authority")],
    program,
  );
export const deriveProposalV3 = (program: PublicKey, id: bigint) => {
  check(id > 0n, "proposal id must be positive");
  return PublicKey.findProgramAddressSync(
    [GOVERNANCE_V3_DOMAIN, Buffer.from("proposal"), u64(id)],
    program,
  );
};
export const deriveBufferAuthorityV3 = (
  program: PublicKey,
  proposal: PublicKey,
) =>
  PublicKey.findProgramAddressSync(
    [GOVERNANCE_V3_DOMAIN, Buffer.from("buffer"), proposal.toBuffer()],
    program,
  );
export const deriveProgramdataV3 = (program: PublicKey) =>
  PublicKey.findProgramAddressSync([program.toBuffer()], LOADER_V3)[0];
export const deriveTargetAuthorityV3 = (
  program: PublicKey,
  target: PublicKey,
) =>
  PublicKey.findProgramAddressSync(
    [GOVERNANCE_V3_DOMAIN, Buffer.from("target-authority"), target.toBuffer()],
    program,
  );
export const deriveTargetGateV3 = (program: PublicKey, target: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [GOVERNANCE_V3_DOMAIN, Buffer.from("gate"), target.toBuffer()],
    program,
  );

export function encodeActionV3(action: ActionV3): Buffer {
  let tag: number, body: Buffer;
  switch (action.kind) {
    case "upgradeController":
      check(
        !action.buffer.equals(PublicKey.default) &&
          action.artifactLength > 0n &&
          action.artifactLength <= 1_572_864n &&
          action.capacity > 0n &&
          action.capacity <= 1_572_864n,
        "invalid upgrade artifact/capacity",
      );
      tag = 0;
      body = Buffer.concat([
        action.buffer.toBuffer(),
        u64(action.artifactLength),
        hash32(action.artifactSha256),
        hash32(action.merkleRoot),
        u64(action.deployedSlot),
        u64(action.capacity),
        hash32(action.sourceCommitment),
        hash32(action.buildCommitment),
      ]);
      break;
    case "setTiming":
      tag = 1;
      body = timingBytes(action.timing);
      break;
    case "rotateCouncil":
      tag = 2;
      body = seatsBytes(action.seats);
      break;
    case "upgradeTarget":
      check(
        !action.buffer.equals(PublicKey.default) &&
          !action.target.equals(PublicKey.default) &&
          action.gateEpoch > 0n &&
          action.artifactLength > 0n &&
          action.artifactLength <= 1_572_864n &&
          action.capacity > 0n &&
          action.capacity <= 1_572_864n,
        "invalid target upgrade",
      );
      tag = 3;
      body = Buffer.concat([
        action.buffer.toBuffer(),
        u64(action.artifactLength),
        hash32(action.merkleRoot),
        u64(action.deployedSlot),
        u64(action.capacity),
        hash32(action.sourceCommitment),
        hash32(action.buildCommitment),
        action.target.toBuffer(),
        u64(action.gateEpoch),
      ]);
      break;
    case "setTargetGate":
      check(
        !action.target.equals(PublicKey.default) &&
          action.expectedEpoch > 0n &&
          typeof action.active === "boolean",
        "invalid gate policy",
      );
      tag = 4;
      body = Buffer.concat([
        action.target.toBuffer(),
        u64(action.expectedEpoch),
        Buffer.from([Number(action.active)]),
      ]);
      break;
    default:
      throw Error("unknown action");
  }
  return Buffer.concat([
    Buffer.from([tag]),
    body,
    Buffer.alloc(192 - body.length),
  ]);
}
class Reader {
  offset = 0;
  constructor(readonly data: Buffer) {}
  bytes(length: number): Buffer {
    check(this.offset + length <= this.data.length, "truncated bytes");
    const out = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }
  byte(): number {
    return this.bytes(1)[0]!;
  }
  u64(): bigint {
    return this.bytes(8).readBigUInt64LE();
  }
  key(): PublicKey {
    return new PublicKey(this.bytes(32));
  }
  timing(): TimingV3 {
    return {
      reviewSlots: this.u64(),
      delaySlots: this.u64(),
      expirySlots: this.u64(),
    };
  }
  reserved(length: number): void {
    check(zero(this.bytes(length)), "nonzero reserved bytes");
  }
}
function decodeActionV3(data: Buffer): ActionV3 {
  check(data.length === 193, "action length");
  const r = new Reader(data);
  const kind = r.byte();
  let result: ActionV3;
  if (kind === 0)
    result = {
      kind: "upgradeController",
      buffer: r.key(),
      artifactLength: r.u64(),
      artifactSha256: r.bytes(32),
      merkleRoot: r.bytes(32),
      deployedSlot: r.u64(),
      capacity: r.u64(),
      sourceCommitment: r.bytes(32),
      buildCommitment: r.bytes(32),
    };
  else if (kind === 1) result = { kind: "setTiming", timing: r.timing() };
  else if (kind === 2)
    result = {
      kind: "rotateCouncil",
      seats: Array.from({ length: 5 }, () => r.key()),
    };
  else if (kind === 3)
    result = {
      kind: "upgradeTarget",
      buffer: r.key(),
      artifactLength: r.u64(),
      merkleRoot: r.bytes(32),
      deployedSlot: r.u64(),
      capacity: r.u64(),
      sourceCommitment: r.bytes(32),
      buildCommitment: r.bytes(32),
      target: r.key(),
      gateEpoch: r.u64(),
    };
  else if (kind === 4) {
    const target = r.key(),
      expectedEpoch = r.u64(),
      active = r.byte();
    check(active <= 1, "invalid gate policy boolean");
    result = {
      kind: "setTargetGate",
      target,
      expectedEpoch,
      active: active === 1,
    };
  } else throw Error("unknown action");
  r.reserved(data.length - r.offset);
  check(encodeActionV3(result).equals(data), "noncanonical action");
  return result;
}
export function decodeConfigV3(
  program: PublicKey,
  key: PublicKey,
  data: Uint8Array,
): ConfigV3 {
  check(data.length === CONFIG_V3_LEN, "config length");
  const r = new Reader(Buffer.from(data));
  check(
    r.bytes(8).equals(Buffer.from("AG3CFG01")) && r.byte() === 1,
    "config header",
  );
  const bump = r.byte();
  check(r.byte() === 1, "config initialized");
  const result: ConfigV3 = {
    bump,
    controller: r.key(),
    programdata: r.key(),
    authority: r.key(),
    treasury: r.key(),
    seats: Array.from({ length: 5 }, () => r.key()),
    councilEpoch: r.u64(),
    timingVersion: r.u64(),
    timing: r.timing(),
    nextId: r.u64(),
  };
  r.reserved(37);
  const [expected, expectedBump] = deriveConfigV3(program);
  check(
    key.equals(expected) &&
      bump === expectedBump &&
      result.controller.equals(program) &&
      result.programdata.equals(deriveProgramdataV3(program)) &&
      result.authority.equals(deriveAuthorityV3(program)[0]),
    "config identity",
  );
  seatsBytes(result.seats);
  validateTimingV3(result.timing);
  check(
    result.councilEpoch > 0n &&
      result.timingVersion > 0n &&
      result.nextId > 0n &&
      !result.treasury.equals(PublicKey.default) &&
      !result.seats.some((x) => x.equals(result.authority)) &&
      ![key, result.programdata, result.controller, result.authority].some(
        (x) => x.equals(result.treasury),
      ),
    "config state",
  );
  return result;
}
export function proposalDigestV3(
  program: PublicKey,
  p: Omit<ProposalV3, "digest"> | ProposalV3,
): Buffer {
  return createHash("sha256")
    .update(
      Buffer.concat([
        Buffer.from("AMOEBA_GOVERNANCE_PROPOSAL_V3"),
        Buffer.from(GOVERNANCE_V3_GENESIS),
        program.toBuffer(),
        p.config.toBuffer(),
        u64(p.id),
        u64(p.councilEpoch),
        u64(p.timingVersion),
        timingBytes(p.timing),
        u64(p.created),
        u64(p.reviewEnd),
        u64(p.notBefore),
        u64(p.expires),
        encodeActionV3(p.action),
      ]),
    )
    .digest();
}
const popcount = (mask: number) => {
  let count = 0;
  for (let x = mask; x; x >>>= 1) count += x & 1;
  return count;
};
export function decodeProposalV3(
  program: PublicKey,
  key: PublicKey,
  data: Uint8Array,
): ProposalV3 {
  check(data.length === PROPOSAL_V3_LEN, "proposal length");
  const r = new Reader(Buffer.from(data));
  check(
    r.bytes(8).equals(Buffer.from("AG3PRP01")) && r.byte() === 1,
    "proposal header",
  );
  const bump = r.byte();
  check(r.byte() === 1, "proposal initialized");
  const p: ProposalV3 = {
    bump,
    config: r.key(),
    id: r.u64(),
    councilEpoch: r.u64(),
    timingVersion: r.u64(),
    timing: r.timing(),
    created: r.u64(),
    reviewEnd: r.u64(),
    notBefore: r.u64(),
    expires: r.u64(),
    action: decodeActionV3(r.bytes(193)),
    digest: r.bytes(32),
    approvals: r.byte(),
    approvalCount: r.byte(),
    cancellations: r.byte(),
    cancellationCount: r.byte(),
    state: r.byte(),
    verifiedChunks: r.bytes(12),
    verifiedCount: r.bytes(4).readUInt32LE(),
    extensionSlot: r.u64(),
    extendedCapacity: r.u64(),
    executedSlot: r.u64(),
  };
  r.reserved(7);
  const [expected, expectedBump] = deriveProposalV3(program, p.id);
  check(
    key.equals(expected) &&
      bump === expectedBump &&
      p.config.equals(deriveConfigV3(program)[0]),
    "proposal identity",
  );
  validateTimingV3(p.timing);
  check(
    p.created > 0n &&
      p.councilEpoch > 0n &&
      p.timingVersion > 0n &&
      p.reviewEnd === p.created + p.timing.reviewSlots &&
      p.notBefore === p.created + p.timing.delaySlots &&
      p.expires === p.created + p.timing.expirySlots,
    "proposal timing",
  );
  check(
    p.approvals < 32 &&
      p.cancellations < 32 &&
      popcount(p.approvals) === p.approvalCount &&
      popcount(p.cancellations) === p.cancellationCount &&
      p.verifiedChunks.reduce((sum, x) => sum + popcount(x), 0) ===
        p.verifiedCount &&
      p.state <= 3 &&
      (p.state === 1) === (p.executedSlot !== 0n) &&
      (p.state !== 1 ||
        (p.approvalCount >= 3 &&
          p.executedSlot >= p.notBefore &&
          p.executedSlot < p.expires)) &&
      (p.state === 2) === p.cancellationCount >= 3,
    "proposal state",
  );
  if (
    p.action.kind === "upgradeController" ||
    p.action.kind === "upgradeTarget"
  )
    check(
      (p.extensionSlot === 0n && p.extendedCapacity === 0n) ||
        (p.extensionSlot >= p.notBefore &&
          p.extensionSlot < p.expires &&
          p.extendedCapacity > p.action.capacity &&
          p.extendedCapacity <= p.action.artifactLength),
      "extension state",
    );
  else
    check(
      p.extensionSlot === 0n &&
        p.extendedCapacity === 0n &&
        p.verifiedCount === 0,
      "policy artifact state",
    );
  check(p.digest.equals(proposalDigestV3(program, p)), "proposal digest");
  return p;
}
const ro = (pubkey: PublicKey): AccountMeta => ({
  pubkey,
  isWritable: false,
  isSigner: false,
});
const rw = (pubkey: PublicKey): AccountMeta => ({
  pubkey,
  isWritable: true,
  isSigner: false,
});
const signer = (pubkey: PublicKey, writable = false): AccountMeta => ({
  pubkey,
  isWritable: writable,
  isSigner: true,
});
function build(
  programId: PublicKey,
  tag: number,
  keys: AccountMeta[],
  payload: Buffer = Buffer.alloc(0),
): TransactionInstruction {
  check(
    new Set(keys.map((x) => x.pubkey.toBase58())).size === keys.length,
    "duplicate accounts",
  );
  const data = Buffer.concat([Buffer.from([tag]), payload]);
  check(data.length <= 16384, "instruction cap");
  return new TransactionInstruction({ programId, keys, data });
}
export function initializeV3(
  program: PublicKey,
  payer: PublicKey,
  deployer: PublicKey,
  seats: PublicKey[],
  treasury: PublicKey,
  consentingSeats: PublicKey[],
): TransactionInstruction {
  seatsBytes(seats);
  check(!treasury.equals(PublicKey.default), "treasury is required");
  check(
    consentingSeats.length === 3 &&
      consentingSeats.every((s) => seats.some((x) => x.equals(s))),
    "three council consents required",
  );
  check(
    !seats.some((s) => s.equals(deriveAuthorityV3(program)[0])),
    "PDA cannot occupy its own council",
  );
  return build(
    program,
    0,
    [
      signer(payer, true),
      signer(deployer),
      ro(program),
      rw(deriveProgramdataV3(program)),
      rw(deriveConfigV3(program)[0]),
      ro(deriveAuthorityV3(program)[0]),
      ro(LOADER_V3),
      ro(SystemProgram.programId),
      ...consentingSeats.map((s) => signer(s)),
    ],
    Buffer.concat([seatsBytes(seats), treasury.toBuffer()]),
  );
}
export function createV3(
  config: ConfigV3,
  payer: PublicKey,
  creator: PublicKey,
  action: ActionV3,
): TransactionInstruction {
  check(
    config.seats.some((x) => x.equals(creator)),
    "creator is not a seat",
  );
  if (action.kind === "rotateCouncil")
    check(
      !action.seats.some((s) => s.equals(config.authority)),
      "PDA cannot occupy its own council",
    );
  return build(
    config.controller,
    1,
    [
      signer(payer, true),
      signer(creator),
      rw(deriveConfigV3(config.controller)[0]),
      rw(deriveProposalV3(config.controller, config.nextId)[0]),
      ro(SystemProgram.programId),
    ],
    Buffer.concat([u64(config.nextId), encodeActionV3(action)]),
  );
}
export function approveV3(
  config: ConfigV3,
  p: ProposalV3,
  seat: PublicKey,
  cancel = false,
): TransactionInstruction {
  check(
    config.seats.some((x) => x.equals(seat)) &&
      p.councilEpoch === config.councilEpoch,
    "inactive seat/council",
  );
  return build(
    config.controller,
    cancel ? 5 : 4,
    [
      ro(deriveConfigV3(config.controller)[0]),
      rw(deriveProposalV3(config.controller, p.id)[0]),
      signer(seat),
    ],
    hash32(p.digest),
  );
}
export function sealBufferV3(
  program: PublicKey,
  p: ProposalV3,
  uploader: PublicKey,
): TransactionInstruction {
  check(
    p.action.kind === "upgradeController" || p.action.kind === "upgradeTarget",
    "upgrade proposal required",
  );
  if (
    p.action.kind !== "upgradeController" &&
    p.action.kind !== "upgradeTarget"
  )
    throw Error("action");
  const key = deriveProposalV3(program, p.id)[0];
  return build(
    program,
    2,
    [
      ro(p.config),
      ro(key),
      rw(p.action.buffer),
      signer(uploader),
      ro(deriveBufferAuthorityV3(program, key)[0]),
      ro(LOADER_V3),
    ],
    hash32(p.digest),
  );
}
export function verifyChunkV3(
  program: PublicKey,
  p: ProposalV3,
  index: number,
  proof: Uint8Array[],
): TransactionInstruction {
  if (
    p.action.kind !== "upgradeController" &&
    p.action.kind !== "upgradeTarget"
  )
    throw Error("upgrade proposal required");
  check(
    Number.isInteger(index) &&
      index >= 0 &&
      index < Number((p.action.artifactLength + 16383n) / 16384n),
    "chunk index",
  );
  check(
    proof.length <= 7 && proof.every((x) => x.length === 32),
    "proof shape",
  );
  const head = Buffer.alloc(5);
  head.writeUInt32LE(index);
  head[4] = proof.length;
  return build(
    program,
    3,
    [ro(p.config), rw(deriveProposalV3(program, p.id)[0]), ro(p.action.buffer)],
    Buffer.concat([
      hash32(p.digest),
      head,
      ...proof.map((x) => Buffer.from(x)),
      Buffer.alloc((7 - proof.length) * 32),
    ]),
  );
}
export function expireV3(
  program: PublicKey,
  p: ProposalV3,
): TransactionInstruction {
  return build(program, 6, [rw(deriveProposalV3(program, p.id)[0])]);
}
export function executePolicyV3(
  program: PublicKey,
  p: ProposalV3,
): TransactionInstruction {
  check(
    p.action.kind === "setTiming" || p.action.kind === "rotateCouncil",
    "council policy proposal required",
  );
  return build(
    program,
    7,
    [rw(p.config), rw(deriveProposalV3(program, p.id)[0])],
    hash32(p.digest),
  );
}
export function executeControllerUpgradeV3(
  config: ConfigV3,
  p: ProposalV3,
): TransactionInstruction {
  if (p.action.kind !== "upgradeController")
    throw Error("upgrade proposal required");
  const program = config.controller,
    key = deriveProposalV3(program, p.id)[0];
  return build(
    program,
    8,
    [
      ro(p.config),
      rw(key),
      rw(program),
      rw(config.programdata),
      rw(p.action.buffer),
      rw(config.treasury),
      ro(config.authority),
      ro(deriveBufferAuthorityV3(program, key)[0]),
      ro(LOADER_V3),
      ro(SYSVAR_RENT_PUBKEY),
      ro(SYSVAR_CLOCK_PUBKEY),
      ro(SYSVAR_INSTRUCTIONS_PUBKEY),
    ],
    hash32(p.digest),
  );
}
export function closeBufferV3(
  config: ConfigV3,
  p: ProposalV3,
): TransactionInstruction {
  if (
    p.action.kind !== "upgradeController" &&
    p.action.kind !== "upgradeTarget"
  )
    throw Error("upgrade proposal required");
  const program = config.controller,
    key = deriveProposalV3(program, p.id)[0];
  return build(
    program,
    9,
    [
      ro(p.config),
      ro(key),
      rw(p.action.buffer),
      rw(config.treasury),
      ro(deriveBufferAuthorityV3(program, key)[0]),
      ro(LOADER_V3),
    ],
    hash32(p.digest),
  );
}
export function extendControllerV3(
  config: ConfigV3,
  p: ProposalV3,
  payer: PublicKey,
): TransactionInstruction {
  if (p.action.kind !== "upgradeController")
    throw Error("upgrade proposal required");
  return build(
    config.controller,
    10,
    [
      ro(p.config),
      rw(deriveProposalV3(config.controller, p.id)[0]),
      rw(config.controller),
      rw(config.programdata),
      rw(config.authority),
      ro(LOADER_V3),
      ro(SystemProgram.programId),
      signer(payer, true),
      ro(SYSVAR_INSTRUCTIONS_PUBKEY),
    ],
    hash32(p.digest),
  );
}

export function registerTargetV3(
  config: ConfigV3,
  target: PublicKey,
  deployer: PublicKey,
  payer: PublicKey,
  consents: PublicKey[],
): TransactionInstruction {
  check(
    !target.equals(config.controller) &&
      consents.length === 3 &&
      new Set(consents.map((x) => x.toBase58())).size === 3 &&
      consents.every((x) => config.seats.some((s) => s.equals(x))),
    "three current seats required",
  );
  return build(config.controller, 11, [
    signer(payer, true),
    signer(deployer),
    ro(deriveConfigV3(config.controller)[0]),
    ro(target),
    rw(deriveProgramdataV3(target)),
    rw(deriveTargetGateV3(config.controller, target)[0]),
    ro(deriveTargetAuthorityV3(config.controller, target)[0]),
    ro(LOADER_V3),
    ro(SystemProgram.programId),
    ...consents.map((x) => signer(x)),
    ro(SYSVAR_INSTRUCTIONS_PUBKEY),
  ]);
}
export function executeTargetUpgradeV3(
  config: ConfigV3,
  p: ProposalV3,
): TransactionInstruction {
  if (p.action.kind !== "upgradeTarget") throw Error("target upgrade required");
  const program = config.controller,
    target = p.action.target,
    key = deriveProposalV3(program, p.id)[0];
  return build(
    program,
    12,
    [
      ro(p.config),
      rw(key),
      rw(target),
      rw(deriveProgramdataV3(target)),
      rw(p.action.buffer),
      rw(config.treasury),
      ro(deriveTargetAuthorityV3(program, target)[0]),
      ro(deriveBufferAuthorityV3(program, key)[0]),
      ro(LOADER_V3),
      ro(SYSVAR_RENT_PUBKEY),
      ro(SYSVAR_CLOCK_PUBKEY),
      ro(SYSVAR_INSTRUCTIONS_PUBKEY),
      rw(deriveTargetGateV3(program, target)[0]),
    ],
    hash32(p.digest),
  );
}
export function extendTargetV3(
  config: ConfigV3,
  p: ProposalV3,
  payer: PublicKey,
): TransactionInstruction {
  if (p.action.kind !== "upgradeTarget") throw Error("target upgrade required");
  const program = config.controller,
    target = p.action.target;
  return build(
    program,
    13,
    [
      ro(p.config),
      rw(deriveProposalV3(program, p.id)[0]),
      rw(target),
      rw(deriveProgramdataV3(target)),
      rw(deriveTargetAuthorityV3(program, target)[0]),
      ro(LOADER_V3),
      ro(SystemProgram.programId),
      signer(payer, true),
      ro(SYSVAR_INSTRUCTIONS_PUBKEY),
      rw(deriveTargetGateV3(program, target)[0]),
    ],
    hash32(p.digest),
  );
}
export function executeTargetGateV3(
  program: PublicKey,
  p: ProposalV3,
): TransactionInstruction {
  if (p.action.kind !== "setTargetGate")
    throw Error("target gate policy required");
  return build(
    program,
    14,
    [
      ro(p.config),
      rw(deriveProposalV3(program, p.id)[0]),
      rw(deriveTargetGateV3(program, p.action.target)[0]),
    ],
    hash32(p.digest),
  );
}
/** RPC callers must separately verify owner, executable=false and privileges. */
export function decodeTargetGateV3(
  program: PublicKey,
  target: PublicKey,
  key: PublicKey,
  data: Uint8Array,
) {
  const r = new Reader(Buffer.from(data));
  check(
    data.length === 192 &&
      r.bytes(8).equals(Buffer.from("AGVGAT01")) &&
      r.byte() === 1,
    "gate header",
  );
  const bump = r.byte();
  check(r.byte() === 1, "gate initialized");
  const status = r.byte(),
    config = r.key(),
    targetProgram = r.key(),
    programdata = r.key(),
    epoch = r.u64(),
    activeProposal = r.key(),
    freezeSlot = r.u64(),
    reason = r.bytes(2).readUInt16LE(),
    lastCompletedProposal = r.key();
  r.reserved(2);
  const expected = deriveTargetGateV3(program, target);
  check(
    !target.equals(program) &&
      key.equals(expected[0]) &&
      bump === expected[1] &&
      config.equals(deriveConfigV3(program)[0]) &&
      targetProgram.equals(target) &&
      programdata.equals(deriveProgramdataV3(target)) &&
      epoch > 0n,
    "gate identity",
  );
  check(
    (status === 0 &&
      activeProposal.equals(PublicKey.default) &&
      freezeSlot === 0n &&
      reason === 0) ||
      (status === 1 &&
        !activeProposal.equals(PublicKey.default) &&
        freezeSlot > 0n &&
        reason > 0) ||
      (status === 2 &&
        activeProposal.equals(PublicKey.default) &&
        freezeSlot > 0n &&
        reason > 0),
    "gate state",
  );
  return {
    bump,
    status,
    config,
    targetProgram,
    programdata,
    epoch,
    activeProposal,
    freezeSlot,
    reason,
    lastCompletedProposal,
  };
}
