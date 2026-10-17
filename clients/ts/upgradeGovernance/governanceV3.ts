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
import {
  ARTIFACT_CHUNK_LEAF_DOMAIN_V1,
  artifactChunkEmptyHash,
  artifactChunkNodeHash,
} from "./artifactMerkleV1.js";
export const GOVERNANCE_V3_GENESIS =
  "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const GOVERNANCE_V3_DOMAIN = Buffer.from("ameba-governance-v3");
export const WEEK_SLOTS_V3 = 1_512_000n;
export const LOADER_V3 = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
export const CONFIG_V3_LEN = 384;
export const PROPOSAL_V3_LEN = 400;
/** V3 artifact ceiling: 128 chunks of 16 KiB, a 128-leaf depth-7 tree. */
export const ARTIFACT_CHUNK_SIZE_V3 = 16_384;
export const MAX_ARTIFACT_CHUNKS_V3 = 128;
export const MAX_ARTIFACT_BYTES_V3 = ARTIFACT_CHUNK_SIZE_V3 * MAX_ARTIFACT_CHUNKS_V3;
/** Release of this controller source (Rust `CONTROLLER_RELEASE`). A
 *  self-upgrade proposal must carry the release of the controller running at
 *  creation: 0 for the deployed pre-release binary, this value afterwards. */
export const CONTROLLER_RELEASE_V3 = 6n;
export const DEVNET_SPREAD_V3 = new PublicKey(
  "2jVQSPny9eFoaG1ZWoJVAezQ5VgqJtF8rQCQXMktuBVw",
);
export interface LightRentPolicyV3 {
  baseRent: number;
  compressionCost: number;
  lamportsPerBytePerEpoch: number;
  maxFundedEpochs: number;
  maxTopUp: number;
}
export interface TimingV3 {
  reviewSlots: bigint;
  delaySlots: bigint;
  expirySlots: bigint;
}
export const DEFAULT_TIMING_V3: Readonly<TimingV3> = Object.freeze({
  reviewSlots: WEEK_SLOTS_V3,
  delaySlots: 150n,
  expirySlots: 2_592_000n,
});
export const OTTER_VERIFY_PROGRAM_V3 = new PublicKey("verifycLy8mB96wd9wqq3WDXQwM4oU6r42Th37Db9fC");
export const VERIFICATION_BUILD_IMAGE_V3 = "solanafoundation/solana-verifiable-build@sha256:0b4e3716fad9ca4b4aac3e3f977f43aad93a18c22296c0c0f44fc22e644bdd68";
export const MAINNET_TARGET_BUILD_IMAGE_V3 = "us-central1-docker.pkg.dev/amoeba-hm0q2k/solana-verifiable-builds/gate-final@sha256:7ad1e567f19831e658f5b892a7269d23d7f1826438e025b5d9d2e385240a4d67";
export const MAINNET_FUTURES_BUILD_IMAGE_V3 = "us-central1-docker.pkg.dev/amoeba-hm0q2k/solana-verifiable-builds/amba-release@sha256:36bdcd0005a5a41f9eba76add58f16fccdc7a2b7b2fbace1be3aaba8cda7b40e";
export const MAINNET_ORACLE_V3 = new PublicKey("45YCerssGjg2M29RFc9D4fAJh7dfFpMJ3ZcZtaTnRXRS");
export const MAINNET_FUTURES_V3 = new PublicKey("Bvp9kiRtJ7dT8unxP4Da39gv2eXDLEHLpcDfzcEuRKMu");
export function deriveVerificationMetadataV3(authority: PublicKey, target: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("otter_verify"), authority.toBuffer(), target.toBuffer()], OTTER_VERIFY_PROGRAM_V3);
}
/** Exact bounded recipe constructed by instruction 16; never includes RPC credentials. */
export function verificationParamsV3(controller: PublicKey, action: Extract<ActionV3, {kind: "publishVerification"}>): Buffer {
  encodeActionV3(action);
  const own = action.target.equals(controller);
  const spread = action.target.equals(DEVNET_SPREAD_V3);
  const oracle = action.target.equals(MAINNET_ORACLE_V3);
  const futures = action.target.equals(MAINNET_FUTURES_V3);
  check(own || spread || oracle || futures, "unsupported verification target");
  const args = own ? [] : spread
    ? ["--mount-path", "programs/light_token_minter", "--workspace-path", "programs/light_token_minter"]
    : ["--workspace-path", oracle ? "oracle" : "futures"];
  const library = own ? "governance_controller_v3" : spread ? "light_token_minter" : oracle ? "ameba_oracle" : "ameba_futures";
  args.push("--library-name", library, "--base-image", futures ? MAINNET_FUTURES_BUILD_IMAGE_V3 : oracle ? MAINNET_TARGET_BUILD_IMAGE_V3 : VERIFICATION_BUILD_IMAGE_V3, "--arch", "v1");
  if (oracle || futures) args.push("--cargo-build-sbf-args", "--tools-version v1.53");
  if (spread) args.push("--", "--features", "mainnet-v3");
  const string = (s: string) => Buffer.concat([uint(Buffer.byteLength(s), 4), Buffer.from(s)]);
  return Buffer.concat([string(oracle || futures ? "0.5.2" : "0.5.1"), string(`https://github.com/amoeba-farm/${own ? "amoeba-governance" : "amoeba-program"}`), string(action.commit), uint(args.length, 4), ...args.map(string), u64(action.deployedSlot)]);
}
export function publishVerificationV3(config: ConfigV3, proposal: ProposalV3, payer: PublicKey): TransactionInstruction {
  check(proposal.action.kind === "publishVerification", "verification proposal required");
  const action = proposal.action as Extract<ActionV3, {kind: "publishVerification"}>;
  verificationParamsV3(config.controller, action);
  check(proposal.config.equals(deriveConfigV3(config.controller)[0]), "proposal config mismatch");
  const own = action.target.equals(config.controller);
  const authority = own ? deriveAuthorityV3(config.controller)[0] : deriveTargetAuthorityV3(config.controller, action.target)[0];
  const keys = [signer(payer, true), ro(proposal.config), rw(deriveProposalV3(config.controller, proposal.id)[0]), ro(action.target), ro(deriveProgramdataV3(action.target)), rw(authority), rw(deriveVerificationMetadataV3(authority, action.target)[0]), ro(OTTER_VERIFY_PROGRAM_V3), ro(SystemProgram.programId), ro(SYSVAR_INSTRUCTIONS_PUBKEY)];
  if (!own) keys.push(ro(deriveTargetGateV3(config.controller, action.target)[0]));
  check(new Set(keys.map(k => k.pubkey.toBase58())).size === keys.length, "duplicate verification accounts");
  return build(config.controller, 16, keys, hash32(proposal.digest));
}
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
      /** Formerly eight zero bytes; see CONTROLLER_RELEASE_V3. */
      controllerRelease: bigint;
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
    }
  | {
      kind: "initializeSpreadLightConfig";
      target: PublicKey;
      expectedEpoch: bigint;
      deployedSlot: bigint;
      compressionAuthority: PublicKey;
      rent: LightRentPolicyV3;
      writeTopUp: number;
      addressTree: PublicKey;
    }
  | {
      kind: "publishVerification";
      target: PublicKey;
      deployedSlot: bigint;
      commit: string;
    }
  | {
      kind: "retireTarget";
      target: PublicKey;
      expectedEpoch: bigint;
      deployedSlot: bigint;
      payloadSha256: Uint8Array;
      recoveryCommitment: Uint8Array;
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
  /** Logical 128-bit chunk bitmap (16 bytes): bytes 0..12 hold chunks 0..96
   *  at their original offset; bytes 12..16 hold chunks 96..128 in the four
   *  former reserved bytes after `executedSlot`. */
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
function uint(value: number, width: 1 | 2 | 4): Buffer {
  check(Number.isSafeInteger(value) && value >= 0 && value < 2 ** (width * 8), "unsigned integer out of range");
  const bytes = Buffer.alloc(width);
  bytes.writeUIntLE(value, 0, width);
  return bytes;
}
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
    timing.reviewSlots >= WEEK_SLOTS_V3 && timing.delaySlots >= 150n,
    "approval needs at least one week and delay at least 150 slots",
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
export const deriveSpreadLightConfigV3 = () =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("compressible_config"), Buffer.from([0, 0])], DEVNET_SPREAD_V3,
  );
export const deriveSpreadRentSponsorV3 = () =>
  PublicKey.findProgramAddressSync([Buffer.from("rent_sponsor")], DEVNET_SPREAD_V3);

export function encodeActionV3(action: ActionV3): Buffer {
  let tag: number, body: Buffer;
  switch (action.kind) {
    case "retireTarget":
      check(!action.target.equals(PublicKey.default) && action.expectedEpoch > 0n && action.deployedSlot > 0n, "invalid retirement policy");
      tag = 7;
      body = Buffer.concat([action.target.toBuffer(), u64(action.expectedEpoch), u64(action.deployedSlot), hash32(action.payloadSha256), hash32(action.recoveryCommitment)]);
      break;
    case "publishVerification":
      check(!action.target.equals(PublicKey.default) && /^[0-9a-f]{40}$/.test(action.commit) && !/^0{40}$/.test(action.commit), "invalid verification policy");
      tag = 6;
      body = Buffer.concat([action.target.toBuffer(), u64(action.deployedSlot), Buffer.from(action.commit, "hex")]);
      break;
    case "upgradeController":
      check(
        !action.buffer.equals(PublicKey.default) &&
          action.artifactLength > 0n &&
          action.artifactLength <= BigInt(MAX_ARTIFACT_BYTES_V3) &&
          action.capacity > 0n,
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
        u64(action.controllerRelease),
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
          action.artifactLength <= BigInt(MAX_ARTIFACT_BYTES_V3) &&
          action.capacity > 0n,
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
    case "initializeSpreadLightConfig":
      check(
        action.target.equals(DEVNET_SPREAD_V3) && action.expectedEpoch > 0n &&
          !action.compressionAuthority.equals(PublicKey.default) &&
          !action.addressTree.equals(PublicKey.default),
        "invalid Spread Light config policy",
      );
      tag = 5;
      body = Buffer.concat([
        action.target.toBuffer(), u64(action.expectedEpoch), u64(action.deployedSlot),
        action.compressionAuthority.toBuffer(),
        uint(action.rent.baseRent, 2), uint(action.rent.compressionCost, 2),
        uint(action.rent.lamportsPerBytePerEpoch, 1), uint(action.rent.maxFundedEpochs, 1),
        uint(action.rent.maxTopUp, 2), uint(action.writeTopUp, 4), action.addressTree.toBuffer(),
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
      controllerRelease: r.u64(),
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
  } else if (kind === 5) {
    result = {
      kind: "initializeSpreadLightConfig", target: r.key(), expectedEpoch: r.u64(),
      deployedSlot: r.u64(), compressionAuthority: r.key(),
      rent: {
        baseRent: r.bytes(2).readUInt16LE(), compressionCost: r.bytes(2).readUInt16LE(),
        lamportsPerBytePerEpoch: r.byte(), maxFundedEpochs: r.byte(), maxTopUp: r.bytes(2).readUInt16LE(),
      },
      writeTopUp: r.bytes(4).readUInt32LE(), addressTree: r.key(),
    };
  } else if (kind === 6) {
    result = { kind: "publishVerification", target: r.key(), deployedSlot: r.u64(), commit: r.bytes(20).toString("hex") };
  } else if (kind === 7) {
    result = { kind: "retireTarget", target: r.key(), expectedEpoch: r.u64(), deployedSlot: r.u64(), payloadSha256: r.bytes(32), recoveryCommitment: r.bytes(32) };
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
  p.verifiedChunks = Buffer.concat([p.verifiedChunks, r.bytes(4)]);
  r.reserved(3);
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
      p.verifiedCount <= artifactChunkCountV3(p.action.artifactLength) &&
      ((p.extensionSlot === 0n && p.extendedCapacity === 0n) ||
        (p.extensionSlot >= p.notBefore &&
          p.extensionSlot < p.expires &&
          p.extendedCapacity > p.action.capacity &&
          p.extendedCapacity <= p.action.artifactLength)),
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
/**
 * Upgrade proposals snapshot the live ProgramData capacity. Grow ProgramData
 * with the permissionless top-level Loader-v3 `ExtendProgram` (for example
 * `solana program extend`) before creating the proposal; the controller has
 * no growth instruction.
 */
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
  if (action.kind === "upgradeController" || action.kind === "upgradeTarget") {
    check(
      action.capacity >= action.artifactLength,
      "extend ProgramData before creating the upgrade proposal",
    );
  }
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
      index < artifactChunkCountV3(p.action.artifactLength),
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
/** Retired: the controller rejects instruction 10. Kept so existing imports
 *  fail with guidance instead of a missing export. */
export function extendControllerV3(
  config: ConfigV3,
  p: ProposalV3,
  payer: PublicKey,
): TransactionInstruction {
  void config;
  void p;
  void payer;
  throw Error(
    "Extend ProgramData with a top-level Loader-v3 ExtendProgram before creating the upgrade proposal; checked extension is retired (enable_extend_program_checked was cancelled) and instructions 10/13 are rejected",
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
/** Retired: the controller rejects instruction 13 like instruction 10. */
export function extendTargetV3(
  config: ConfigV3,
  p: ProposalV3,
  payer: PublicKey,
): TransactionInstruction {
  void config;
  void p;
  void payer;
  throw Error(
    "Extend ProgramData with a top-level Loader-v3 ExtendProgram before creating the upgrade proposal; checked extension is retired (enable_extend_program_checked was cancelled) and instructions 10/13 are rejected",
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
/** Permanently close the exact frozen target's ProgramData to the treasury. */
export function retireTargetV3(config: ConfigV3, p: ProposalV3): TransactionInstruction {
  if (p.action.kind !== "retireTarget") throw Error("retirement proposal required");
  const program = config.controller, target = p.action.target;
  return build(program, 17, [
    ro(p.config), rw(deriveProposalV3(program, p.id)[0]), rw(target),
    rw(deriveProgramdataV3(target)), rw(deriveTargetGateV3(program, target)[0]),
    rw(config.treasury), ro(deriveTargetAuthorityV3(program, target)[0]),
    ro(LOADER_V3), ro(SYSVAR_INSTRUCTIONS_PUBKEY),
  ], hash32(p.digest));
}
/** Reclaim only target-specific governance records after Loader closure. */
export function reclaimRetiredTargetRecordsV3(config: ConfigV3, target: PublicKey, records: PublicKey[]): TransactionInstruction {
  check(records.length > 0, "records required");
  return build(config.controller, 18, [
    ro(deriveConfigV3(config.controller)[0]), ro(target), ro(deriveProgramdataV3(target)),
    rw(config.treasury), ...records.map(rw),
  ], target.toBuffer());
}
/** Close the retired target's canonical verification record and refund its PDA. */
export function reclaimRetiredTargetVerificationV3(config: ConfigV3, target: PublicKey): TransactionInstruction {
  const authority = deriveTargetAuthorityV3(config.controller, target)[0];
  return build(config.controller, 19, [
    ro(deriveConfigV3(config.controller)[0]), ro(target), ro(deriveProgramdataV3(target)),
    rw(config.treasury), rw(authority), rw(deriveVerificationMetadataV3(authority, target)[0]),
    ro(OTTER_VERIFY_PROGRAM_V3), ro(SystemProgram.programId),
  ], target.toBuffer());
}
/** Fixed create-once CPI; the proposal binds every configurable Light field. */
export function executeSpreadLightConfigV3(
  program: PublicKey, p: ProposalV3, payer: PublicKey,
): TransactionInstruction {
  if (p.action.kind !== "initializeSpreadLightConfig") throw Error("Spread Light config policy required");
  encodeActionV3(p.action);
  const target = p.action.target;
  return build(program, 15, [
    signer(payer, true), ro(p.config), rw(deriveProposalV3(program, p.id)[0]), ro(target),
    ro(deriveProgramdataV3(target)), ro(deriveTargetGateV3(program, target)[0]),
    ro(deriveTargetAuthorityV3(program, target)[0]), rw(deriveSpreadLightConfigV3()[0]),
    ro(SystemProgram.programId), ro(SYSVAR_INSTRUCTIONS_PUBKEY),
  ], hash32(p.digest));
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

/** Chunk count under the V3 2 MiB ceiling. */
export function artifactChunkCountV3(artifactLength: bigint | number): number {
  const length = BigInt(artifactLength);
  check(
    length > 0n && length <= BigInt(MAX_ARTIFACT_BYTES_V3),
    "artifact length outside the V3 2 MiB bound",
  );
  const size = BigInt(ARTIFACT_CHUNK_SIZE_V3);
  return Number((length + size - 1n) / size);
}
function artifactLeafHashV3(index: number, chunk: Uint8Array): Buffer {
  check(
    Number.isInteger(index) && index >= 0 && index < MAX_ARTIFACT_CHUNKS_V3 &&
      chunk.length > 0 && chunk.length <= ARTIFACT_CHUNK_SIZE_V3,
    "invalid V3 artifact leaf",
  );
  return createHash("sha256")
    .update(ARTIFACT_CHUNK_LEAF_DOMAIN_V1)
    .update(uint(index, 4))
    .update(uint(chunk.length, 4))
    .update(chunk)
    .digest();
}
function artifactLevelV3(artifact: Uint8Array): Buffer[] {
  const count = artifactChunkCountV3(artifact.length);
  const level: Buffer[] = [];
  for (let i = 0; i < count; i += 1)
    level.push(artifactLeafHashV3(i, artifact.subarray(i * ARTIFACT_CHUNK_SIZE_V3, (i + 1) * ARTIFACT_CHUNK_SIZE_V3)));
  let padded = 1;
  while (padded < count) padded *= 2;
  for (let i = count; i < padded; i += 1) level.push(artifactChunkEmptyHash(i));
  return level;
}
function nextLevelV3(level: Buffer[]): Buffer[] {
  const next: Buffer[] = [];
  for (let i = 0; i < level.length; i += 2) next.push(artifactChunkNodeHash(level[i]!, level[i + 1]!));
  return next;
}
/** Length-bound Merkle root accepted by V3 upgrade actions (same scheme as
 *  Release 1, admitting up to 128 chunks). */
export function artifactMerkleRootV3(artifact: Uint8Array): Buffer {
  let level = artifactLevelV3(artifact);
  while (level.length > 1) level = nextLevelV3(level);
  return level[0]!;
}
/** Sibling path for `verifyChunkV3`; at most seven hashes. */
export function artifactMerkleProofV3(artifact: Uint8Array, index: number): Buffer[] {
  let level = artifactLevelV3(artifact);
  check(Number.isInteger(index) && index >= 0 && index < artifactChunkCountV3(artifact.length), "chunk index");
  const proof: Buffer[] = [];
  for (let node = index; level.length > 1; node >>= 1) {
    proof.push(level[node ^ 1]!);
    level = nextLevelV3(level);
  }
  return proof;
}
