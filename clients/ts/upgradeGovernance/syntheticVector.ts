import { PublicKey } from "@solana/web3.js";
import {
  governanceCouncilSetHash,
  governancePolicyHash,
  type CouncilSeatV1Input,
  type GovernanceCouncilSetV1Input,
  type GovernancePolicyV1Input,
  type ProposalDigestInputV1,
} from "./v1.js";

export const syntheticKey = (byte: number): PublicKey =>
  new PublicKey(Uint8Array.from({ length: 32 }, () => byte));

const bytes = (byte: number): Buffer => Buffer.alloc(32, byte);

const syntheticSeat = (authorityByte: number): CouncilSeatV1Input => ({
  seatAuthority: syntheticKey(authorityByte),
  termStartSlot: 10n,
  termEndSlot: 10_000n,
  active: true,
  reserved: Buffer.alloc(47),
});

export function syntheticPolicyV1(): GovernancePolicyV1Input {
  const value: GovernancePolicyV1Input = {
    discriminator: Buffer.from("AGVPOL01", "ascii"),
    accountVersion: 1,
    bump: 201,
    initialized: true,
    controllerConfig: syntheticKey(2),
    version: 7n,
    targetProgram: syntheticKey(3),
    activationSlot: 0x0102_0304_0506_0708n,
    councilSize: 5,
    routineThreshold: 3,
    terminalThreshold: 4,
    governanceMode: 0,
    policyFlags: 0,
    vetoQuorumBps: 0,
    affirmativeQuorumBps: 0,
    affirmativeApprovalBps: 0,
    routineRequiresVote: false,
    economicRequiresVote: false,
    constitutionalRequiresVote: false,
    rotationRequiresVote: false,
    immutabilityRequiresVote: false,
    policyHash: Buffer.alloc(32),
    reserved: Buffer.alloc(21),
  };
  value.policyHash = governancePolicyHash(value);
  return value;
}

export function syntheticCouncilV1(): GovernanceCouncilSetV1Input {
  const value: GovernanceCouncilSetV1Input = {
    discriminator: Buffer.from("AGVCNS01", "ascii"),
    accountVersion: 1,
    bump: 202,
    initialized: true,
    controllerConfig: syntheticKey(2),
    version: 11n,
    targetProgram: syntheticKey(3),
    activationSlot: 100n,
    deactivationSlot: 0n,
    seats: [
      syntheticSeat(20),
      syntheticSeat(21),
      syntheticSeat(22),
      syntheticSeat(23),
      syntheticSeat(24),
    ],
    routineThreshold: 3,
    terminalThreshold: 4,
    policyFlags: 0,
    setHash: Buffer.alloc(32),
    reserved: Buffer.alloc(26),
  };
  value.setHash = governanceCouncilSetHash(value);
  return value;
}

export const syntheticPolicyHashV1 = syntheticPolicyV1().policyHash;
export const syntheticCouncilHashV1 = syntheticCouncilV1().setHash;

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
    councilHash: syntheticCouncilHashV1,
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
    voteProgram: defaultKey,
    voteResultPda: defaultKey,
    voteRequirement: 0,
    reviewStartSlot: 0x2122_2324_2526_2728n,
    reviewEndSlot: 0x3132_3334_3536_3738n,
    notBeforeSlot: 0x4142_4344_4546_4748n,
    expirySlot: 0x5152_5354_5556_5758n,
  };
}
