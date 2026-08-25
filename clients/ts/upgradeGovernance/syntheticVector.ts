import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import type { ProposalDigestInputV1 } from "./v1.js";

export const syntheticKey = (byte: number): PublicKey =>
  new PublicKey(Uint8Array.from({ length: 32 }, () => byte));
const bytes = (byte: number): Buffer => Buffer.alloc(32, byte);
const u64 = (value: bigint): Buffer => {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
};
const u16 = (value: number): Buffer => {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value);
  return out;
};

const policyMaterial = Buffer.concat([
  syntheticKey(2).toBuffer(),
  syntheticKey(3).toBuffer(),
  u64(7n),
  u64(0x0102_0304_0506_0708n),
  Buffer.from([3, 2, 4, 3, 2]),
  u16(1500),
  u16(2000),
  u16(6667),
  Buffer.from([1, 1, 1, 1, 1]),
]);

export const syntheticPolicyHashV1 = createHash("sha256")
  .update(Buffer.from("AMOEBA_GOVERNANCE_POLICY_V1", "ascii"))
  .update(policyMaterial)
  .digest();

export function syntheticProposalDigestInputV1(): ProposalDigestInputV1 {
  const defaultKey = new PublicKey(new Uint8Array(32));
  return {
    clusterDomain: bytes(1),
    controllerProgram: syntheticKey(1),
    controllerConfig: syntheticKey(2),
    protocolGate: syntheticKey(7),
    policyVersion: 7n,
    policyHash: syntheticPolicyHashV1,
    targetProgram: syntheticKey(3),
    targetProgramdata: syntheticKey(4),
    upgradeableLoader: syntheticKey(5),
    authorityPda: syntheticKey(6),
    canonicalSpillTreasury: syntheticKey(8),
    proposalId: 0x0102_0304_0506_0708n,
    targetNonce: 0x1112_1314_1516_1718n,
    proposalClass: 0,
    councilVersion: 11n,
    councilHash: bytes(32),
    creationGateEpoch: 41n,
    freezeGateEpoch: 42n,
    bufferPubkey: syntheticKey(15),
    bufferLoaderOwner: syntheticKey(5),
    bufferAuthority: syntheticKey(6),
    artifactLength: 1_142_664n,
    artifactSha256: bytes(33),
    sourceCommitHash: bytes(34),
    sourceTreeHash: bytes(35),
    buildInputInventoryHash: bytes(36),
    reproducibleBuildReceiptHash: bytes(37),
    packageReceiptHash: bytes(38),
    releaseIntentHash: bytes(39),
    currentDeployedPayloadHash: bytes(40),
    currentRawProgramdataHash: bytes(41),
    deployedSlot: 487_702_729n,
    currentCapacity: 1_241_776n,
    extensionDelta: 0n,
    expectedPostCapacity: 1_241_776n,
    prestateCheckpoint: syntheticKey(16),
    requiredPoststateCheckpoint: syntheticKey(17),
    rollbackProposal: { present: false, value: defaultKey },
    rollbackBuffer: { present: false, value: defaultKey },
    rollbackArtifactHash: Buffer.alloc(32),
    voteProgram: syntheticKey(10),
    voteResultPda: syntheticKey(18),
    voteRequirement: 1,
    reviewStartSlot: 0x2122_2324_2526_2728n,
    reviewEndSlot: 0x3132_3334_3536_3738n,
    notBeforeSlot: 0x4142_4344_4546_4748n,
    expirySlot: 0x5152_5354_5556_5758n,
  };
}
