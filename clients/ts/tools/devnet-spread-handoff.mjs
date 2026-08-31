import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import bs58Module from "bs58";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  RpcBackoffExit,
  assertExactKeys,
  guardRpcConnection,
  loadSecureKeypair,
  openJournal,
  operationId,
  reconcileOneFinalized,
  selfTestCeremonyRuntime,
  sha256Hex,
  submitOneFinalized,
  withCeremonyRpcOwnerLock,
  writeExclusiveJson,
} from "./devnet-ceremony-runtime.mjs";
import {
  loadDevnetRpcConfiguration,
  requireSecureDirectory,
  requireSecureRegularFile,
} from "./secure-rpc-env.mjs";

import {
  ARTIFACT_MERKLE_SCHEME_ID,
  MAX_ARTIFACT_BYTES_V1,
  RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
  artifactChunkCount,
  artifactMerkleProof,
  artifactMerkleRoot,
} from "../dist/upgradeGovernance/artifactMerkleV1.js";
import {
  BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1,
  GateStatusV1,
} from "../dist/upgradeGovernance/release1.js";
import {
  CeremonyProposalStateV1,
  CEREMONY_PROPOSAL_COMPLETED_REASON_V1,
  CEREMONY_ACCOUNT_VERSION_V1,
  BOOTSTRAP_ACTIVATION_PROPOSAL_V1_LEN,
  BOOTSTRAP_ACTIVATION_RECEIPT_V1_LEN,
  BOOTSTRAP_ACTIVATION_RECEIPT_V1_DISCRIMINATOR,
  BOOTSTRAP_ACTIVATION_RECEIPT_V1_RESERVED_LEN,
  CURRENT_DEPLOYMENT_STATE_V1_DISCRIMINATOR,
  CURRENT_DEPLOYMENT_STATE_V1_LEN,
  CURRENT_DEPLOYMENT_STATE_V1_RESERVED_LEN,
  CONTROLLER_IMMUTABILITY_RECEIPT_V1_LEN,
  PROGRAMDATA_OBSERVATION_V1_LEN,
  PROGRAMDATA_CAPACITY_POLICY_V1_LEN,
  TARGET_AUTHORITY_HANDOFF_PROPOSAL_V1_LEN,
  TARGET_AUTHORITY_HANDOFF_RECEIPT_V1_LEN,
  ProgramDataObservationPurposeV1,
  ProgramDataObservationStatusV1,
  bootstrapActivationDeploymentPlanDigestV1,
  bootstrapActivationReceiptPlanDigestV1,
  deriveBootstrapActivationProposalPdaV1,
  deriveBootstrapActivationReceiptPdaV1,
  deriveCapacityPolicyPdaV1,
  deriveControllerImmutabilityReceiptPdaV1,
  deriveCurrentDeploymentStatePdaV1,
  deriveProgramDataObservationPdaV1,
  deriveTargetAuthorityHandoffProposalPdaV1,
  deriveTargetAuthorityHandoffReceiptPdaV1,
  deserializeBootstrapActivationProposalV1,
  deserializeBootstrapActivationReceiptV1,
  deserializeControllerImmutabilityReceiptV1,
  deserializeCurrentDeploymentStateV1,
  deserializeProgramDataCapacityPolicyV1,
  deserializeProgramDataObservationV1,
  deserializeTargetAuthorityHandoffProposalV1,
  deserializeTargetAuthorityHandoffReceiptV1,
  programDataObservationSubjectDigestV1,
  validateBootstrapActivationProposalDigestV1,
  validateBootstrapActivationReceiptDigestV1,
  validateControllerImmutabilityReceiptDigestV1,
  validateCurrentDeploymentDigestV1,
  validateProgramDataCapacityPolicyDigestV1,
  validateProgramDataObservationDigestV1,
  validateTargetAuthorityHandoffProposalDigestV1,
  validateTargetAuthorityHandoffReceiptDigestV1,
} from "../dist/upgradeGovernance/release1Ceremony.js";
import {
  buildAppendProgramDataObservationChunkV1Instruction,
  buildBeginProgramDataObservationV1Instruction,
  buildFinalizeProgramDataObservationV1Instruction,
  buildVerifyObservedArtifactChunkV1Instruction,
} from "../dist/upgradeGovernance/release1CeremonyInstructions.js";
import {
  buildAcceptTargetAuthorityCheckedV1Instruction,
  buildApproveBootstrapActivationV1Instruction,
  buildApproveTargetAuthorityHandoffV1Instruction,
  buildCreateBootstrapActivationV1Instruction,
  buildCreateTargetAuthorityHandoffV1Instruction,
  buildExecuteBootstrapActivationV1Instruction,
  buildQueueBootstrapActivationV1Instruction,
  buildQueueTargetAuthorityHandoffV1Instruction,
} from "../dist/upgradeGovernance/release1AuthorityInstructions.js";
import {
  PROGRAMDATA_OBSERVATION_MERKLE_SCHEME_ID_V1,
  PROGRAMDATA_OBSERVATION_CHUNK_SIZE_16_KIB_V1,
  programDataObservationGeometryV1,
  programDataObservationMerkleRootV1,
  programDataRawSha256ReceiptV1,
} from "../dist/upgradeGovernance/programDataObservationMerkleV1.js";
import { clusterDomainFromGenesisHashV1 } from "../dist/upgradeGovernance/release1Planning.js";
import {
  BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  CONTROLLER_CONFIG_LEN,
  GOVERNANCE_COUNCIL_SET_LEN,
  GOVERNANCE_POLICY_LEN,
  PROTOCOL_GATE_LEN,
  deriveAuthorityPda,
  deriveControllerConfigPda,
  deriveCouncilPda,
  deriveGatePda,
  derivePolicyPda,
  deserializeProtocolGateV1,
  governanceCouncilSetHash,
  governancePolicyHash,
} from "../dist/upgradeGovernance/v1.js";
import {
  deserializeControllerConfigV1,
  deserializeGovernanceCouncilSetFixedV1,
  deserializeGovernancePolicyFixedV1,
} from "../dist/upgradeGovernance/v1FixedAccounts.js";

process.umask(0o077);

const bs58 = bs58Module.default ?? bs58Module;

const EXPECTED_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const CONTROLLER = new PublicKey("CzyGUEVtLg2FTWdZmQ6KZCydw73KutLtE6c5PJgnxQqa");
const CONTROLLER_PROGRAMDATA = new PublicKey("H9zckD4ukjmKQL6tF5G9uZWixKomxeXxW2CPA3MkgPN9");
const TARGET = new PublicKey("9ipkBCjEfeJDMF6AFrezRmDDHmbnmeyv45cfXNqAnWsH");
const TARGET_PROGRAMDATA = new PublicKey("2DBN762WGdNc85xiVdvQX7Lo4TXAq3WhVz9mBQcaU3a3");
const LEGACY_AUTHORITY = new PublicKey("D5jhTM3kYHdKixrc52Kn657gBHytQLhQqsTmJBcNFVdq");
const PAYER = new PublicKey("G2f6Fv477ZyFbmRFtVr21jf9VufXpiRCxf1e91J6SxxT");
const TREASURY = new PublicKey("8XUjnzVzR71DaVuqbSHaNev5H4vrxofyFP4iZt2FXa1j");
const SEATS = [
  new PublicKey("pSutXCyMTkwvzG1kpiHXULkVKyzz8NPSNgnjLgwNcTu"),
  new PublicKey("4vrxWeSfCoJA8KvzCcWGgG4C5S4gPYrLaRWysycJeVpz"),
  new PublicKey("DgMGtSjUg1wXPZuPBT6HqGN3qRLVBJCqYrv31XtcwcBR"),
  new PublicKey("4SJyALW3CinnBrFUzHeJL6v5KM12hw2FGLL1wbVTVfn8"),
  new PublicKey("Cmd42MrYC7CVyQNGq7GRkTqR3jQ8cBPKzjzDpsc5eNW4"),
];

const KMS = Object.freeze({
  "legacy-target-authority": Object.freeze({
    publicKey: LEGACY_AUTHORITY,
    pemEnvironment: "AMEBA_LEGACY_AUTHORITY_KMS_PUBLIC_PEM",
    resource: "projects/amoeba-hm0q2k/locations/global/keyRings/ameba-spread-devnet/cryptoKeys/upgrade-authority-v1/cryptoKeyVersions/1",
  }),
  "seat-0": Object.freeze({
    publicKey: SEATS[0],
    pemEnvironment: "AMEBA_SEAT_0_KMS_PUBLIC_PEM",
    resource: "projects/amoeba-hm0q2k/locations/global/keyRings/ameba-spread-devnet/cryptoKeys/governance-seat-1-v1/cryptoKeyVersions/1",
  }),
  "seat-1": Object.freeze({
    publicKey: SEATS[1],
    pemEnvironment: "AMEBA_SEAT_1_KMS_PUBLIC_PEM",
    resource: "projects/amoeba-hm0q2k/locations/global/keyRings/ameba-spread-devnet/cryptoKeys/governance-seat-2-v1/cryptoKeyVersions/1",
  }),
  "seat-2": Object.freeze({
    publicKey: SEATS[2],
    pemEnvironment: "AMEBA_SEAT_2_KMS_PUBLIC_PEM",
    resource: "projects/amoeba-hm0q2k/locations/global/keyRings/ameba-spread-devnet/cryptoKeys/governance-seat-3-v1/cryptoKeyVersions/1",
  }),
});

const PLAN_SCHEMA = "ameba-governance-devnet-spread-handoff-plan-v2";
const PLAN_FILE = "spread-handoff-plan-v2.json";
const RECEIPT_SCHEMA = "ameba-governance-devnet-spread-handoff-receipt-v1";
const RECEIPT_FILE = "spread-handoff-receipt-v1.json";
const JOURNAL_NAME = "spread-handoff-journal-v1";
const PLANNING_JOURNAL_NAME = "spread-handoff-planning-journal-v1";
const OBSERVATION_GENERATION = 1n;
const ACTIVATION_OBSERVATION_GENERATION = 1n;
const ACTIVATION_PLAN_SCHEMA = "ameba-governance-devnet-bootstrap-activation-plan-v3";
const ACTIVATION_PLAN_FILE = "spread-bootstrap-activation-plan-v3.json";
const ACTIVATION_REPLAN_PATTERN = /^spread-bootstrap-activation-replan-v1-([0-9a-f]{64})\.json$/u;
const ACTIVATION_RECEIPT_SCHEMA = "ameba-governance-devnet-bootstrap-activation-receipt-v3";
const ACTIVATION_RECEIPT_FILE = "spread-bootstrap-activation-receipt-v3.json";
const EPOCH_PROBE_RECEIPT_SCHEMA = "ameba-governance-devnet-spread-epoch-probes-v1";
const EPOCH_PROBE_RECEIPT_FILE = "spread-bootstrap-activation-epoch-probes-v1.json";
const NEGATIVE_PROOF_SCHEMA = "ameba-governance-devnet-former-authority-negative-proof-v1";
const NEGATIVE_PROOF_FILE = "spread-former-authority-negative-proof-v1.json";
const PROOF_BUFFER_CLOSE_RECEIPT_SCHEMA = "ameba-governance-devnet-former-authority-proof-buffer-close-receipt-v1";
const PROOF_BUFFER_CLOSE_RECEIPT_FILE = "spread-former-authority-proof-buffer-close-receipt-v1.json";
const PROOF_BUFFER_CLOSE_RECEIPT_DOMAIN = "AMOEBA_DEVNET_FORMER_AUTHORITY_PROOF_BUFFER_CLOSE_RECEIPT_V1";
const ACTIVATION_JOURNAL_NAME = "spread-bootstrap-activation-journal-v1";
const ACTIVATION_PLANNING_JOURNAL_NAME = "spread-bootstrap-activation-planning-journal-v1";
const BUFFER_HEADER_LEN = 37;
const LOADER_UPGRADE_DATA = Buffer.from([3, 0, 0, 0]);
const LOADER_CLOSE_DATA = Buffer.from([5, 0, 0, 0]);
const COMPUTE_UNIT_LIMIT = 1_400_000;
const COMPUTE_UNIT_PRICE = 1n;
const PLAN_TTL_SLOTS = 100_000;
const CEREMONY_SEAT_TERM_SAFETY_SLOTS = 10_000n;
const CEREMONY_TRANSITION_SLOT_ALLOWANCE = 64n;
const PROGRAMDATA_HEADER_LEN = 45;
const PROGRAM_ACCOUNT_LEN = 36;
const MAX_PACKET_BYTES = 1_232;
const FINALIZED_STATUS_POLL_INTERVAL_MS = 30_000;
const FINALIZED_CONNECTION_CONFIG = Object.freeze({
  commitment: "finalized",
  disableRetryOnRateLimit: true,
});
const ZERO_32 = Buffer.alloc(32);
const SIGNER_TOOL = fileURLToPath(new URL("./gcp-kms-ed25519-signer.mjs", import.meta.url));
const CEREMONY_BUILD_RECEIPT_FILE = "spread-governance-bridge-ceremony-build-receipt-v1.json";
const CEREMONY_BUILD_RECEIPT_SCHEMA = "ameba-spread-governance-bridge-ceremony-build-receipt-v1";
const CEREMONY_BUILD_INVENTORY_FILE = "spread-governance-bridge-build-input-inventory-v1.json";
const RELEASE_MANIFEST_FILE = "spread-devnet-bridge-release-manifest-v1.json";
const PHASE3_INSTRUCTION_MANIFEST_FILE = "phase-3-instruction-manifest-v1.json";
const PHASE3_INSTRUCTION_MANIFEST_SCHEMA = "ameba-spread-phase-3-instruction-manifest-v1";
const PHASE3_INSTRUCTION_MANIFEST_REPOSITORY_PATH = "docs/governance/generated/phase-3-instruction-manifest-v1.json";
const FROZEN_GATE_CENSUS_SCHEMA = "ameba-governance-devnet-spread-frozen-gate-census-v1";
const FROZEN_GATE_CENSUS_FILE = "spread-frozen-gate-instruction-census-v1.json";
const FROZEN_GATE_CENSUS_DOMAIN = "AMOEBA_GOVERNANCE_DEVNET_SPREAD_FROZEN_GATE_CENSUS_V1";
const GOVERNANCE_GATE_FROZEN_ERROR = 6263;
const GENERIC_INVALID_INSTRUCTION_ERROR = 6000;

const PLAN_KEYS = [
  "schema", "operationId", "mainnetAllowed", "cluster", "rpc", "plannedAtSlot",
  "planValidUntilSlot", "identities", "baseAccountFingerprints", "artifact", "evidence",
  "gate", "governance", "programdata", "observation", "handoff", "transactionBlueprints",
  "toolSha256",
];

const FROZEN_GATE_CENSUS_KEYS = [
  "schema", "mainnetAllowed", "genesisHash", "targetProgram", "protocolGate",
  "gateStatus", "gateEpoch", "manifestFile", "manifestRawSha256", "buildInventoryRawSha256",
  "observedSlotBefore", "observedSlotAfter", "programdataRawSha256Before",
  "programdataRawSha256After", "gateAccountSha256Before", "gateAccountSha256After",
  "assignedMutatorCount", "unknownCount", "reservedCount", "results", "stateMutationObserved",
  "toolSha256", "receiptSha256",
];

const PROOF_BUFFER_RECEIPT_FILE = "spread-former-authority-proof-buffer-receipt-v1.json";
const BRIDGE_DEPLOYMENT_PLAN_FILE = "spread-reviewed-bridge-deployment-plan-v1.json";
const BRIDGE_UPGRADE_RECEIPT_FILE = "spread-reviewed-bridge-upgrade-receipt-v1.json";
const BRIDGE_UPGRADE_RECEIPT_SCHEMA = "ameba-spread-reviewed-governance-bridge-upgrade-receipt-v1";
const BRIDGE_UPGRADE_RECEIPT_DOMAIN = "AMOEBA_SPREAD_REVIEWED_BRIDGE_UPGRADE_RECEIPT_V1";
const EXPECTED_HISTORICAL_BRIDGE_RECEIPT_ADAPTER_SHA256 = "a66eb9a120386992f4e45cbbbb095d701f938c986959a05de6f07060035f33a0";
const FIRST_POST_SUMMARY_SCHEMA = "ameba-spread-governance-bridge-ceremony-validation-summary-v1";
const FIRST_POST_SUMMARY_DOMAIN = "ameba-spread-governance-bridge-ceremony-validation-summary-v1\0";
const UPGRADE_RECEIPT_DOMAIN = "ameba-spread-programdata-upgrade-receipt-v2\0";
const POSTSTATE_REPEAT_RECEIPT_FILE = "spread-bridge-poststate-repeat-receipt-v1.json";
const POSTSTATE_REPEAT_RECEIPT_SCHEMA = "ameba-spread-governance-bridge-poststate-repeat-receipt-v1";
const POSTSTATE_REPEAT_RECEIPT_DOMAIN = "ameba-spread-governance-bridge-poststate-repeat-receipt-v1\0";
const FIRST_POST_FILE_PATTERN = /^spread-bridge-compatibility-post-attempt-([0-9]{4})-(summary\.json|upgrade-receipt\.json|programdata\.raw)$/u;
const POSTSTATE_REPEAT_CENSUS_PATTERN = /^spread-bridge-poststate-repeat-attempt-([0-9]{4})-census\.json$/u;
const POSTSTATE_REPEAT_RAW_PATTERN = /^spread-bridge-poststate-repeat-attempt-([0-9]{4})-programdata\.raw$/u;
const AUTHORITY_DELTA_CENSUS_SCHEMA = "ameba-spread-governance-bridge-authority-delta-census-receipt-v1";
const AUTHORITY_DELTA_CENSUS_DOMAIN = "ameba-spread-governance-bridge-authority-delta-census-receipt-v1\0";
const AUTHORITY_DELTA_MODE = "legacy-authority-to-controller-pda-only-v1";
const AUTHORITY_DELTA_FILE_PATTERN = /^spread-bridge-(post-handoff|post-activation)-authority-delta-attempt-([0-9]{4})-(census\.json|programdata\.raw|receipt\.json)$/u;
const COMPATIBILITY_INVENTORY_KEYS = [
  "schemaVersion", "compatibilityMode", "programAccountCount", "programAccountDataBytes",
  "programAccountInventorySha256", "derivedExternalReferenceCount",
  "derivedExternalReferenceSetSha256", "supplementalExternalReferenceCount",
  "supplementalExternalReferenceSetSha256", "externalReferenceCount", "externalAccountCount",
  "externalExistingAccountCount", "externalAbsentAccountCount", "externalAccountDataBytes",
  "externalAccountInventorySha256", "combinedInventorySha256",
];
const BRIDGE_UPGRADE_RECEIPT_KEYS = [
  "schema", "operationId", "planSha256", "genesisHash", "targetProgram",
  "targetProgramdata", "loader", "legacyUpgradeAuthority", "canonicalSpill", "primaryBuffer",
  "formerAuthorityProofBuffer", "compatibilityAdapterSha256",
  "planningCompatibilitySummaryRawSha256", "preSignCompatibilitySummaryRawSha256",
  "preSignCapacityReportRawSha256", "primaryBufferEvidenceRawSha256",
  "postCompatibilitySummaryRawSha256", "authoritativePostSummaryFile",
  "authoritativeUpgradeReceiptRawSha256", "authoritativeUpgradeReceiptFile",
  "authoritativePostProgramDataRawSha256", "authoritativePostProgramDataRawFile",
  "artifactSha256", "artifactBytes", "transactionSignature", "transactionSlot",
  "topLevelInstructionCount", "loaderUpgradeInstructionCount", "siblingInstructionCount",
  "extensionInstructionCount", "postUpgradeAuthority", "postCapacityBytes",
  "finalizedContextSlot", "postDeployedSlot", "postProgramDataRawSha256",
  "postProgramDataPayloadSha256", "deployedArtifactSha256", "trailingBytes",
  "trailingBytesSha256", "trailingBytesAllZero", "primaryBufferClosed",
  "formerAuthorityProofBufferPreserved", "formerAuthorityProofBufferRawSha256", "receiptSha256",
];
// This exact order is the frozen historical JavaScript locale-order encoding
// used to create the immutable bridge receipt. It is explicit so validation is
// independent of the current host language and locale.
const BRIDGE_UPGRADE_RECEIPT_HASH_KEY_ORDER = [
  "artifactBytes", "artifactSha256", "authoritativePostProgramDataRawFile",
  "authoritativePostProgramDataRawSha256", "authoritativePostSummaryFile",
  "authoritativeUpgradeReceiptFile", "authoritativeUpgradeReceiptRawSha256",
  "canonicalSpill", "compatibilityAdapterSha256", "deployedArtifactSha256",
  "extensionInstructionCount", "finalizedContextSlot", "formerAuthorityProofBuffer",
  "formerAuthorityProofBufferPreserved", "formerAuthorityProofBufferRawSha256",
  "genesisHash", "legacyUpgradeAuthority", "loader", "loaderUpgradeInstructionCount",
  "operationId", "planningCompatibilitySummaryRawSha256", "planSha256",
  "postCapacityBytes", "postCompatibilitySummaryRawSha256", "postDeployedSlot",
  "postProgramDataPayloadSha256", "postProgramDataRawSha256", "postUpgradeAuthority",
  "preSignCapacityReportRawSha256", "preSignCompatibilitySummaryRawSha256",
  "primaryBuffer", "primaryBufferClosed", "primaryBufferEvidenceRawSha256", "schema",
  "siblingInstructionCount", "targetProgram", "targetProgramdata", "topLevelInstructionCount",
  "trailingBytes", "trailingBytesAllZero", "trailingBytesSha256", "transactionSignature",
  "transactionSlot",
];
const FIRST_POST_SUMMARY_KEYS = [
  "schema", "schemaVersion", "phase", "evidenceMode", "planningSummaryRawSha256",
  "preSignSummaryRawSha256", "buildReceiptRawSha256", "controller", "target", "artifact",
  "prestate", "upgrade", "poststate", "summarySha256",
];
const UPGRADE_RECEIPT_KEYS = [
  "schemaVersion", "kind", "ok", "programId", "programDataAddress", "loaderProgramId",
  "genesisHash", "programDataCapacityEvidenceKind", "programDataCapacityEvidenceSha256",
  "extensionReceiptSha256", "extensionTransactionSignature", "bufferPrestateReceiptSha256",
  "upgradeCompatibilityPrestateSha256", "postUpgradeCompatibilitySha256", "buildReceiptSha256",
  "artifactSha256", "artifactSizeBytes", "transactionSignature", "transactionSlot",
  "finalizedContextSlot", "bufferAddress", "spillAddress", "upgradeAuthority",
  "programDataRawBytes", "programDataPayloadCapacityBytes", "programDataPayloadSha256",
  "deployedArtifactSha256", "trailingBytes", "trailingBytesSha256", "trailingBytesAllZero",
  "deployedSlot", "preservedProgramLinkOwnerExecutableAndAuthority",
  "preservedCompatibleCurrentState", "receiptSha256",
];
const POSTSTATE_REPEAT_RECEIPT_KEYS = [
  "schema", "schemaVersion", "kind", "evidenceMode", "evidenceFiles", "build", "controller",
  "target", "artifact", "firstPost", "repeat", "historyExclusion", "comparison", "receiptSha256",
];
const PROOF_BUFFER_RECEIPT_KEYS = [
  "schema", "mainnetAllowed", "genesisHash", "targetProgram", "targetProgramData",
  "loader", "proofBuffer", "bufferAuthority", "spillTreasury",
  "artifactBytes", "artifactSha256", "artifactMerkleRoot", "artifactChunkSize",
  "artifactChunkCount", "bufferRawBytes", "bufferRawSha256", "bufferPayloadOffset",
  "finalizedSlot", "sourceDeploymentPlanSha256", "sourceDeploymentReceiptSha256",
];
const ACTIVATION_PLAN_KEYS = [
  "schema", "operationId", "mainnetAllowed", "cluster", "rpc", "plannedAtSlot",
  "planValidUntilSlot", "identities", "baseAccountFingerprints", "artifact", "evidence",
  "gate", "governance", "programdata", "handoff", "negative", "observation",
  "activation", "transactionBlueprints", "toolSha256",
];
const NEGATIVE_PROOF_KEYS = [
  "schema", "operationId", "planSha256", "mainnetAllowed", "genesisHash", "stage",
  "signature", "finalizedSlot", "messageSha256", "wireSha256", "wireBytes",
  "simulationError", "simulationLogs", "finalizedError", "finalizedLogs",
  "exactErrorName", "proofBuffer", "proofBufferRawSha256", "formerAuthority",
  "targetProgram", "targetProgramdata", "controllerAuthority", "programdataRawSha256Before",
  "programdataRawSha256After", "programdataDeployedSlotBefore", "programdataDeployedSlotAfter",
  "gateAccountSha256Before", "gateAccountSha256After", "handoffReceiptAccountSha256Before",
  "handoffReceiptAccountSha256After", "proofBufferAccountSha256Before",
  "proofBufferAccountSha256After", "spillAccountSha256Before", "spillAccountSha256After",
  "accountMutationObserved", "journalEntrySha256",
];
const PROOF_BUFFER_CLOSE_RECEIPT_KEYS = [
  "schema", "operationId", "planSha256", "mainnetAllowed", "genesisHash", "stage",
  "proofBuffer", "proofBufferReceiptSha256", "negativeProof", "negativeProofSha256",
  "negativeFailureSignature", "loader", "closeInstructionDataHex", "formerAuthority",
  "feePayer", "spillTreasury", "messageSha256", "wireSha256", "wireBytes", "signature",
  "finalizedSlot", "proofBufferLamports", "treasuryLamportsBefore", "treasuryLamportsAfter",
  "treasuryLamportDelta", "treasuryAccountSha256Before", "treasuryAccountSha256After",
  "proofBufferRawSha256Before", "proofBufferAccountSha256Before",
  "proofBufferPoststate", "targetProgram", "targetProgramdata", "controllerAuthority",
  "programdataRawSha256Before", "programdataRawSha256After", "programdataDeployedSlotBefore",
  "programdataDeployedSlotAfter", "gateAccountSha256Before", "gateAccountSha256After",
  "handoffReceiptAccountSha256Before", "handoffReceiptAccountSha256After",
  "targetMutationObserved", "journalEntrySha256", "receiptSha256",
];
const HANDOFF_RECEIPT_KEYS = [
  "schema", "operationId", "planSha256", "genesisHash", "controllerProgram",
  "controllerConfig", "controllerAuthority", "targetProgram", "targetProgramdata",
  "legacyAuthority", "observation", "observationDigest", "observationRoot", "proposal",
  "proposalDigest", "handoffReceipt", "handoffReceiptDigest", "acceptedSlot",
  "finalObservationSlot", "authorityBefore", "authorityAfter", "programdataPreRawSha256",
  "programdataPostRawSha256", "artifactSha256", "artifactMerkleRoot", "gateStatus",
  "gateEpoch", "targetNonce", "controllerRemainedImmutable", "targetNonceConsumed",
  "gateChanged", "finalizedTransactions", "accountRawSha256",
  "formerAuthorityNegativeTestCompleted", "bootstrapActivationCompleted", "mainnetAllowed",
];
const EPOCH_PROBE_RECEIPT_KEYS = [
  "schema", "operationId", "planSha256", "mainnetAllowed", "genesisHash",
  "targetProgram", "protocolGate", "oldEpoch", "currentEpoch", "observedSlotBefore",
  "observedSlotAfter", "stateSha256Before", "stateSha256After", "stateMutationObserved",
  "oldEpochResult", "currentEpochResult",
];
const ACTIVATION_RECEIPT_KEYS = [
  "schema", "operationId", "planSha256", "mainnetAllowed", "genesisHash",
  "controllerProgram", "controllerProgramdata", "controllerConfig", "controllerAuthority",
  "targetProgram", "targetProgramdata", "handoffProposal", "handoffProposalDigest",
  "handoffReceipt", "handoffReceiptDigest", "handoffAcceptedSlot", "negativeProof",
  "negativeProofSha256", "negativeFailureSignature", "negativeFailureFinalizedSlot",
  "proofBufferCloseReceipt", "proofBufferCloseReceiptSha256", "proofBufferCloseSignature",
  "proofBufferCloseFinalizedSlot",
  "observation", "observationDigest", "observationRoot", "activationProposal",
  "activationProposalDigest", "activationReceipt", "activationReceiptDigest",
  "currentDeployment", "currentDeploymentDigest", "creationSlot", "reviewStartSlot",
  "reviewEndSlot", "notBeforeSlot", "expirySlot", "executedSlot", "approvalBitset",
  "approvalCount", "gateBefore", "gateAfter", "targetNonceBefore", "targetNonceAfter",
  "targetNonceConsumed", "authorityBefore", "authorityAfter", "artifactBytes",
  "artifactSha256", "artifactMerkleRoot", "programdataDeployedSlot", "programdataCapacity",
  "programdataRawSha256", "programdataPayloadSha256", "controllerRemainedImmutable",
  "loaderCpiExecuted", "epochProbeReceipt", "epochProbeReceiptSha256",
  "postHandoffAuthorityDeltaReceipt", "postHandoffAuthorityDeltaReceiptRawSha256",
  "postHandoffAuthorityDeltaReceiptSha256", "postActivationAuthorityDeltaReceipt",
  "postActivationAuthorityDeltaReceiptRawSha256", "postActivationAuthorityDeltaReceiptSha256",
  "postActivationCensusRawSha256", "postActivationProgramDataRawSha256",
  "finalizedTransactions", "accountRawSha256", "bootstrapActivationCompleted",
];

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  assert(value, `missing required environment ${name}`);
  return value;
}

function hashBytes(...parts) {
  const hash = createHash("sha256");
  parts.forEach((part) => hash.update(part));
  return hash.digest();
}

function recursivelySortedJsonValue(value) {
  if (Array.isArray(value)) return value.map(recursivelySortedJsonValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, recursivelySortedJsonValue(value[key])]),
    );
  }
  return value;
}

function compactCanonicalJson(value) {
  return JSON.stringify(recursivelySortedJsonValue(value));
}

function sortedPrettyCanonicalJson(value) {
  return `${JSON.stringify(recursivelySortedJsonValue(value), null, 2)}\n`;
}

function orderedPrettyCanonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function parseCanonicalJson(bytes, label, { sorted = true } = {}) {
  const textValue = bytes.toString("utf8");
  assert(Buffer.from(textValue, "utf8").equals(bytes), `${label} is not valid UTF-8`);
  let value;
  try {
    value = JSON.parse(textValue);
  } catch (error) {
    throw new Error(`${label} is not JSON: ${error.message}`);
  }
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be a JSON object`);
  if (sorted !== null) {
    const canonical = sorted ? sortedPrettyCanonicalJson(value) : orderedPrettyCanonicalJson(value);
    assert(Buffer.from(canonical, "utf8").equals(bytes), `${label} is not canonical pretty JSON`);
  }
  return value;
}

function compareUnicodeCodePoints(left, right) {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0));
  const rightPoints = Array.from(right, (character) => character.codePointAt(0));
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

// Python produced the active-state census with json.dumps(sort_keys=True). Some
// account fields exceed JavaScript's safe-integer range, so JSON.parse followed
// by JSON.stringify cannot reproduce the committed Python bytes. Parse the
// canonical JSON lexically, preserve every number token, and return the exact
// compact representation of one top-level member while also enforcing the
// recursive Python key order and duplicate-key exclusion.
function compactPythonCanonicalTopLevelMember(bytes, memberName, label) {
  const source = bytes.toString("utf8");
  assert(Buffer.from(source, "utf8").equals(bytes), `${label} is not valid UTF-8`);
  let offset = 0;
  let selected = null;

  function skipWhitespace() {
    while (offset < source.length && /[\u0009\u000a\u000d\u0020]/u.test(source[offset])) offset += 1;
  }

  function parseString() {
    assert.equal(source[offset], "\"", `${label} contains a malformed JSON string`);
    const start = offset;
    offset += 1;
    while (offset < source.length) {
      const character = source[offset];
      if (character === "\"") {
        offset += 1;
        const raw = source.slice(start, offset);
        let value;
        try {
          value = JSON.parse(raw);
        } catch (error) {
          throw new Error(`${label} contains an invalid JSON string: ${error.message}`);
        }
        return { raw, value };
      }
      if (character === "\\") {
        offset += 1;
        assert(offset < source.length, `${label} contains a truncated JSON escape`);
        if (source[offset] === "u") {
          assert(/^[0-9a-fA-F]{4}$/u.test(source.slice(offset + 1, offset + 5)), `${label} contains an invalid Unicode escape`);
          offset += 5;
        } else {
          assert(/["\\/bfnrt]/u.test(source[offset]), `${label} contains an invalid JSON escape`);
          offset += 1;
        }
        continue;
      }
      assert(character.codePointAt(0) >= 0x20, `${label} contains an unescaped control character`);
      offset += character.length;
    }
    throw new Error(`${label} contains an unterminated JSON string`);
  }

  function parseNumber() {
    const match = source.slice(offset).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u);
    assert(match, `${label} contains an invalid JSON number`);
    offset += match[0].length;
    return match[0];
  }

  function parseValue(topLevel = false) {
    skipWhitespace();
    if (source[offset] === "{") return parseObject(topLevel);
    if (source[offset] === "[") return parseArray();
    if (source[offset] === "\"") return parseString().raw;
    for (const literal of ["true", "false", "null"]) {
      if (source.startsWith(literal, offset)) {
        offset += literal.length;
        return literal;
      }
    }
    return parseNumber();
  }

  function parseArray() {
    offset += 1;
    skipWhitespace();
    const values = [];
    if (source[offset] === "]") {
      offset += 1;
      return "[]";
    }
    while (true) {
      values.push(parseValue());
      skipWhitespace();
      if (source[offset] === "]") {
        offset += 1;
        return `[${values.join(",")}]`;
      }
      assert.equal(source[offset], ",", `${label} contains a malformed JSON array`);
      offset += 1;
    }
  }

  function parseObject(topLevel) {
    offset += 1;
    skipWhitespace();
    const fields = [];
    let previousKey = null;
    if (source[offset] === "}") {
      offset += 1;
      return "{}";
    }
    while (true) {
      skipWhitespace();
      const key = parseString();
      if (previousKey !== null) {
        assert(compareUnicodeCodePoints(previousKey, key.value) < 0, `${label} object keys are duplicated or not Python-canonical`);
      }
      previousKey = key.value;
      skipWhitespace();
      assert.equal(source[offset], ":", `${label} contains a malformed JSON object`);
      offset += 1;
      const compactValue = parseValue();
      fields.push(`${key.raw}:${compactValue}`);
      if (topLevel && key.value === memberName) {
        assert.equal(selected, null, `${label} contains duplicate ${memberName} fields`);
        selected = compactValue;
      }
      skipWhitespace();
      if (source[offset] === "}") {
        offset += 1;
        return `{${fields.join(",")}}`;
      }
      assert.equal(source[offset], ",", `${label} contains a malformed JSON object`);
      offset += 1;
    }
  }

  parseValue(true);
  skipWhitespace();
  assert.equal(offset, source.length, `${label} has trailing non-whitespace data`);
  assert.notEqual(selected, null, `${label} is missing ${memberName}`);
  return selected;
}

function semanticJsonHash(domain, value, hashField) {
  const unsigned = { ...value };
  delete unsigned[hashField];
  return sha256Hex(Buffer.concat([
    Buffer.from(domain, "utf8"),
    Buffer.from(compactCanonicalJson(unsigned), "utf8"),
  ]));
}

function bridgeUpgradeReceiptHash(value) {
  const unsigned = { ...value };
  delete unsigned.receiptSha256;
  assertExactKeys(unsigned, BRIDGE_UPGRADE_RECEIPT_HASH_KEY_ORDER, "unsigned reviewed bridge upgrade receipt");
  const ordered = Object.fromEntries(
    BRIDGE_UPGRADE_RECEIPT_HASH_KEY_ORDER.map((field) => [field, unsigned[field]]),
  );
  return sha256Hex(Buffer.concat([
    Buffer.from(BRIDGE_UPGRADE_RECEIPT_DOMAIN, "utf8"),
    Buffer.from(JSON.stringify(ordered), "utf8"),
  ]));
}

function assertSafeInteger(value, label, minimum = 0) {
  assert(Number.isSafeInteger(value) && value >= minimum, `${label} is invalid`);
  return value;
}

function assertSignature(value, label) {
  assert(typeof value === "string", `${label} is not a string`);
  let decoded;
  try {
    decoded = bs58.decode(value);
  } catch {
    throw new Error(`${label} is not base58`);
  }
  assert.equal(decoded.length, 64, `${label} is not a 64-byte signature`);
  return value;
}

function assertCanonicalBasename(value, pattern, label) {
  assert.equal(typeof value, "string", `${label} is not a string`);
  assert.equal(path.basename(value), value, `${label} is not a basename`);
  const match = pattern.exec(value);
  assert(match, `${label} is not canonical`);
  return match;
}

function validateCompatibilityInventory(value, label) {
  assertExactKeys(value, COMPATIBILITY_INVENTORY_KEYS, label);
  assert.equal(value.schemaVersion, 4, `${label} schema changed`);
  assert.equal(value.compatibilityMode, "active-state-code-only-v1", `${label} mode changed`);
  for (const field of [
    "programAccountCount", "programAccountDataBytes", "derivedExternalReferenceCount",
    "supplementalExternalReferenceCount", "externalReferenceCount", "externalAccountCount",
    "externalExistingAccountCount", "externalAbsentAccountCount", "externalAccountDataBytes",
  ]) assertSafeInteger(value[field], `${label} ${field}`);
  for (const field of [
    "programAccountInventorySha256", "derivedExternalReferenceSetSha256",
    "supplementalExternalReferenceSetSha256", "externalAccountInventorySha256",
    "combinedInventorySha256",
  ]) assertLowerHash(value[field], `${label} ${field}`);
  assert.equal(
    value.externalExistingAccountCount + value.externalAbsentAccountCount,
    value.externalAccountCount,
    `${label} external account count changed`,
  );
  assert.equal(
    value.derivedExternalReferenceCount + value.supplementalExternalReferenceCount,
    value.externalReferenceCount,
    `${label} external reference count changed`,
  );
  return value;
}

function validateCeremonyBuildInventory(value, raw, label = "Spread bridge ceremony build inventory") {
  assertExactKeys(value, ["schemaVersion", "generator", "git", "cargo", "summary", "files"], label);
  assert.equal(value.schemaVersion, 1, `${label} version changed`);
  assert.equal(value.generator, "scripts/build_input_inventory.py", `${label} generator changed`);
  assertExactKeys(value.git, ["head", "clean"], `${label} git`);
  assert(/^[0-9a-f]{40}$/u.test(value.git.head), `${label} Git HEAD is malformed`);
  assert.equal(value.git.clean, true, `${label} was not captured from a clean tree`);
  assert(value.summary && typeof value.summary === "object", `${label} summary is absent`);
  assertSafeInteger(value.summary.fileCount, `${label} file count`, 1);
  assertLowerHash(value.summary.aggregateSha256, `${label} aggregate SHA-256`);
  assert(Array.isArray(value.files) && value.files.length === value.summary.fileCount, `${label} file count changed`);
  const aggregate = createHash("sha256");
  const byPath = new Map();
  let priorPath = "";
  for (const item of value.files) {
    assertExactKeys(item, ["path", "category", "sha256", "sizeBytes", "tracked"], `${label} file`);
    assert(typeof item.path === "string" && item.path > priorPath, `${label} paths are not strictly sorted and unique`);
    assert.equal(path.posix.normalize(item.path), item.path, `${label} path is not canonical`);
    assert(!item.path.startsWith("../") && !path.posix.isAbsolute(item.path), `${label} path escapes the repository`);
    assert.equal(item.tracked, true, `${label} contains an untracked input`);
    assertLowerHash(item.sha256, `${label} ${item.path} SHA-256`);
    assertSafeInteger(item.sizeBytes, `${label} ${item.path} size`);
    aggregate.update(`${item.sha256}  ${item.sizeBytes}  ${item.path}\n`, "utf8");
    priorPath = item.path;
    byPath.set(item.path, item);
  }
  assert.equal(aggregate.digest("hex"), value.summary.aggregateSha256, `${label} aggregate changed`);
  assert(Buffer.from(sortedPrettyCanonicalJson(value), "utf8").equals(raw), `${label} raw encoding changed`);
  return { value, raw, byPath };
}

function validateCeremonyBuildReceiptLineage(value, raw, artifactSha256, artifactBytes) {
  assertExactKeys(value, [
    "schema", "schemaVersion", "createdAtUnixMs", "mainnetAllowed", "ceremonyMode",
    "prebuildPlan", "controllerImmutabilityEvidence", "source", "identity", "artifact",
    "reproducibleBuild", "inputs", "verification", "toolchain",
  ], "Spread bridge ceremony build receipt");
  assert.equal(value.schema, CEREMONY_BUILD_RECEIPT_SCHEMA, "Spread bridge build receipt schema changed");
  assert.equal(value.schemaVersion, 1, "Spread bridge build receipt version changed");
  assert.equal(value.mainnetAllowed, false, "Spread bridge build receipt allows Mainnet");
  assert.equal(value.ceremonyMode, "feature-branch-local-annotated-tag", "Spread bridge ceremony mode changed");
  assert.equal(value.source?.repository, "SPACE999978/ameba_spread", "Spread bridge source repository changed");
  assert(/^[0-9a-f]{40}$/u.test(value.source?.commit), "Spread bridge source commit is malformed");
  assert(/^[0-9a-f]{40}$/u.test(value.source?.tree), "Spread bridge source tree is malformed");
  assert.equal(value.source?.clean, true, "Spread bridge source tree was not clean");
  assert.equal(value.identity?.targetProgramId, TARGET.toBase58(), "Spread bridge build target changed");
  assert.equal(value.identity?.controllerProgramId, CONTROLLER.toBase58(), "Spread bridge build controller changed");
  assert.equal(value.identity?.controllerProgramData, CONTROLLER_PROGRAMDATA.toBase58(), "Spread bridge build controller ProgramData changed");
  assert.equal(value.identity?.productionUseAuthorized, true, "Spread bridge build is not production-authorized");
  assert.equal(value.artifact?.path, "light_token_minter.so", "Spread bridge artifact basename changed");
  assert.equal(value.artifact?.sha256, artifactSha256, "Spread bridge build artifact SHA-256 changed");
  assert.equal(value.artifact?.sizeBytes, artifactBytes, "Spread bridge build artifact size changed");
  assert.equal(value.artifact?.runtime, "sbpf-v0", "Spread bridge artifact runtime changed");
  assert.equal(value.artifact?.programDataExtensionRequired, false, "Spread bridge build requires an unreviewed extension");
  assert.equal(value.reproducibleBuild?.independentBuildCount, 2, "Spread bridge build is not twice reproducible");
  assert.equal(value.reproducibleBuild?.reproducibleSha256, artifactSha256, "Spread bridge reproducible hash changed");
  assert.equal(value.inputs?.path, CEREMONY_BUILD_INVENTORY_FILE, "Spread bridge build inventory basename changed");
  assertLowerHash(value.inputs?.sha256, "Spread bridge build inventory raw SHA-256");
  assertLowerHash(value.inputs?.aggregateSha256, "Spread bridge build inventory aggregate SHA-256");
  assert.equal(value.inputs?.gitCommit, value.source.commit, "Spread bridge input inventory commit changed");
  assert.equal(value.inputs?.gitTree, value.source.tree, "Spread bridge input inventory tree changed");
  assert.equal(value.inputs?.clean, true, "Spread bridge input inventory was not clean");
  assert.equal(value.verification?.noFreshFunctionalTestClaim, true, "Spread bridge build makes an unauthorized fresh-test claim");
  assert.deepEqual(value.verification?.functionalSuitesRunByThisBuild, [], "Spread bridge build claims rerun functional suites");
  assert(Buffer.from(orderedPrettyCanonicalJson(value), "utf8").equals(raw), "Spread bridge build receipt raw encoding changed");
  return value;
}

function validatePhase3InstructionManifest(value, raw) {
  assertExactKeys(value, ["schema", "target_source_baseline", "reserved_bytes", "build_counts", "tags"], "Phase 3 instruction manifest");
  assert.equal(value.schema, PHASE3_INSTRUCTION_MANIFEST_SCHEMA, "Phase 3 instruction manifest schema changed");
  assert.deepEqual(value.reserved_bytes, [249, 250, 251], "Phase 3 reserved tags changed");
  assert(Array.isArray(value.tags) && value.tags.length === 256, "Phase 3 instruction manifest is not exhaustive");
  const counts = { Unknown: 0, Reserved: 0, RecognizedReadOnly: 0, RecognizedMutating: 0, FeatureGatedMutating: 0 };
  value.tags.forEach((entry, index) => {
    assertExactKeys(entry, ["byte", "name", "registry_source", "feature_condition", "default_class", "devnet_backfill_class"], `Phase 3 instruction tag ${index}`);
    assert.equal(entry.byte, index, `Phase 3 instruction tag ${index} is missing or reordered`);
    assert(Object.hasOwn(counts, entry.default_class), `Phase 3 instruction tag ${index} has an unknown class`);
    counts[entry.default_class] += 1;
  });
  assert.deepEqual(counts, value.build_counts.default, "Phase 3 default-build counts changed");
  assert.equal(counts.RecognizedReadOnly, 0, "Phase 3 unexpectedly contains a read-only assigned tag");
  assert.equal(counts.FeatureGatedMutating, 0, "the reviewed bridge default build unexpectedly enables backfill tags");
  assert.equal(counts.RecognizedMutating, 129, "Phase 3 assigned mutator count changed");
  assert.equal(counts.Unknown, 124, "Phase 3 unknown-tag count changed");
  assert.equal(counts.Reserved, 3, "Phase 3 reserved-tag count changed");
  assert(raw.at(-1) === 0x0a && !raw.includes(0x0d), "Phase 3 instruction manifest line encoding changed");
  return { value, raw, counts };
}

function validateAuthorityDeltaSnapshot(value, label) {
  assertExactKeys(value, [
    "censusRawSha256", "contextSlot", "compatibilityObservation", "compatibilityFullSha256",
    "compatibilityInventory", "deployedSlot", "upgradeAuthority", "programDataRawBytes",
    "programDataPayloadCapacityBytes", "programDataRawSha256", "programDataPayloadSha256",
    "programExecutablePrefixSha256", "programDataLamports",
  ], label);
  for (const field of [
    "censusRawSha256", "compatibilityFullSha256", "programDataRawSha256",
    "programDataPayloadSha256", "programExecutablePrefixSha256",
  ]) assertLowerHash(value[field], `${label} ${field}`);
  for (const field of [
    "contextSlot", "deployedSlot", "programDataRawBytes", "programDataPayloadCapacityBytes",
    "programDataLamports",
  ]) assertSafeInteger(value[field], `${label} ${field}`);
  assert(value.contextSlot > 0, `${label} context slot is zero`);
  assert.equal(value.programDataPayloadCapacityBytes, value.programDataRawBytes - PROGRAMDATA_HEADER_LEN, `${label} capacity changed`);
  publicKey(value.upgradeAuthority, `${label} authority`);
  assertExactKeys(value.compatibilityObservation, ["captureStartSlot", "programInventoryVerifiedSlot", "contextSlot"], `${label} compatibility observation`);
  const observation = value.compatibilityObservation;
  for (const field of Object.keys(observation)) assertSafeInteger(observation[field], `${label} ${field}`, 1);
  assert(observation.captureStartSlot <= observation.programInventoryVerifiedSlot, `${label} program inventory slots are reversed`);
  assert(observation.programInventoryVerifiedSlot <= observation.contextSlot, `${label} compatibility slots are reversed`);
  assert(observation.contextSlot <= value.contextSlot, `${label} compatibility census postdates ProgramData`);
  validateCompatibilityInventory(value.compatibilityInventory, `${label} compatibility inventory`);
  return value;
}

function assertAuthorityDeltaProgramdataBytes(baselineRaw, currentRaw, receipt) {
  assert.equal(baselineRaw.length, currentRaw.length, "authority-delta ProgramData raw length changed");
  assert.equal(baselineRaw.readUInt32LE(0), 3, "authority-delta baseline is not ProgramData");
  assert.equal(currentRaw.readUInt32LE(0), 3, "authority-delta current is not ProgramData");
  assert.equal(baselineRaw[12], 1, "authority-delta baseline authority is absent");
  assert.equal(currentRaw[12], 1, "authority-delta current authority is absent");
  assert(new PublicKey(baselineRaw.subarray(13, 45)).equals(LEGACY_AUTHORITY), "authority-delta baseline raw authority changed");
  const [controllerAuthority] = deriveAuthorityPda(CONTROLLER, TARGET);
  assert(new PublicKey(currentRaw.subarray(13, 45)).equals(controllerAuthority), "authority-delta current raw authority changed");
  assert(baselineRaw.subarray(0, 13).equals(currentRaw.subarray(0, 13)), "authority-delta changed ProgramData metadata before the authority bytes");
  assert(baselineRaw.subarray(45).equals(currentRaw.subarray(45)), "authority-delta changed ProgramData payload bytes");
  let changedByteCount = 0;
  for (let index = 13; index < 45; index += 1) {
    if (baselineRaw[index] !== currentRaw[index]) changedByteCount += 1;
  }
  assert.equal(changedByteCount, receipt.authorityDelta.changedByteCount, "authority-delta changed-byte count differs from raw ProgramData");
}

async function readAuthorityDeltaEvidence(inputs, phase, environment, prior = null, { optional = false } = {}) {
  const configured = process.env[environment]?.trim();
  if (!configured) {
    if (optional) return null;
    throw new Error(`missing required environment ${environment}`);
  }
  const receiptFile = await requireSecureRegularFile(configured, `${phase} authority-delta receipt`);
  assert.equal(path.dirname(path.resolve(receiptFile)), path.resolve(inputs.bridgeRunDir), `${phase} authority-delta receipt is outside the bridge run directory`);
  const receiptName = path.basename(receiptFile);
  const receiptMatch = AUTHORITY_DELTA_FILE_PATTERN.exec(receiptName);
  assert(receiptMatch && receiptMatch[1] === phase && receiptMatch[3] === "receipt.json", `${phase} authority-delta receipt basename changed`);
  const attempt = Number(receiptMatch[2]);
  assert(attempt >= 1 && attempt <= 9_999, `${phase} authority-delta attempt is invalid`);
  const receiptBytes = await readFile(receiptFile);
  const value = parseCanonicalJson(receiptBytes, `${phase} authority-delta receipt`);
  assertExactKeys(value, [
    "schema", "schemaVersion", "kind", "mode", "phase", "attempt", "evidenceFiles",
    "bindings", "target", "baseline", "current", "authorityDelta", "invariants", "receiptSha256",
  ], `${phase} authority-delta receipt`);
  assert.equal(value.schema, AUTHORITY_DELTA_CENSUS_SCHEMA, `${phase} authority-delta schema changed`);
  assert.equal(value.schemaVersion, 1, `${phase} authority-delta version changed`);
  assert.equal(value.kind, "ameba-spread-governance-bridge-authority-delta-census", `${phase} authority-delta kind changed`);
  assert.equal(value.mode, AUTHORITY_DELTA_MODE, `${phase} authority-delta mode changed`);
  assert.equal(value.phase, phase, `${phase} authority-delta phase changed`);
  assert.equal(value.attempt, attempt, `${phase} authority-delta attempt differs from its filename`);
  assertExactKeys(value.evidenceFiles, [
    "artifact", "buildReceipt", "baselineCensus", "baselineProgramDataRaw", "currentCensus",
    "currentProgramDataRaw", "priorAuthorityDeltaReceipt", "receipt",
  ], `${phase} authority-delta evidence files`);
  assert.equal(value.evidenceFiles.artifact, path.basename(inputs.artifactFile), `${phase} authority-delta artifact basename changed`);
  assert.equal(value.evidenceFiles.buildReceipt, CEREMONY_BUILD_RECEIPT_FILE, `${phase} authority-delta build receipt changed`);
  assert.equal(value.evidenceFiles.baselineCensus, path.basename(inputs.bridgeEvidence.repeatCensus.file), `${phase} authority-delta baseline census changed`);
  assert.equal(value.evidenceFiles.baselineProgramDataRaw, path.basename(inputs.bridgeEvidence.repeatRaw.file), `${phase} authority-delta baseline ProgramData changed`);
  assert.equal(value.evidenceFiles.receipt, receiptName, `${phase} authority-delta receipt self-reference changed`);
  const censusMatch = assertCanonicalBasename(value.evidenceFiles.currentCensus, AUTHORITY_DELTA_FILE_PATTERN, `${phase} authority-delta census filename`);
  const rawMatch = assertCanonicalBasename(value.evidenceFiles.currentProgramDataRaw, AUTHORITY_DELTA_FILE_PATTERN, `${phase} authority-delta raw filename`);
  assert.equal(censusMatch[1], phase); assert.equal(censusMatch[2], receiptMatch[2]); assert.equal(censusMatch[3], "census.json");
  assert.equal(rawMatch[1], phase); assert.equal(rawMatch[2], receiptMatch[2]); assert.equal(rawMatch[3], "programdata.raw");
  if (phase === "post-handoff") {
    assert.equal(value.evidenceFiles.priorAuthorityDeltaReceipt, null, "post-handoff authority-delta receipt has a prior receipt");
    assert.equal(prior, null, "post-handoff authority-delta validation was given a prior receipt");
  } else {
    assert(prior, "post-activation authority-delta receipt lacks the validated post-handoff receipt");
    assert.equal(value.evidenceFiles.priorAuthorityDeltaReceipt, path.basename(prior.file), "post-activation prior receipt basename changed");
  }
  const census = await readRunFile(inputs.bridgeRunDir, value.evidenceFiles.currentCensus, `${phase} authority-delta census`);
  parseCanonicalJson(census.bytes, `${phase} authority-delta census`);
  const currentRaw = await readRunFile(inputs.bridgeRunDir, value.evidenceFiles.currentProgramDataRaw, `${phase} authority-delta ProgramData`);
  assertExactKeys(value.bindings, [
    "artifactSha256", "artifactBytes", "buildReceiptRawSha256", "baselineCensusRawSha256",
    "baselineProgramDataRawSha256", "currentCensusRawSha256", "currentProgramDataRawSha256",
    "priorAuthorityDeltaReceiptRawSha256",
  ], `${phase} authority-delta bindings`);
  assert.equal(value.bindings.artifactSha256, inputs.artifactSha256, `${phase} authority-delta artifact hash changed`);
  assert.equal(value.bindings.artifactBytes, inputs.artifact.length, `${phase} authority-delta artifact size changed`);
  assert.equal(value.bindings.buildReceiptRawSha256, inputs.evidence.source.sha256, `${phase} authority-delta build receipt hash changed`);
  assert.equal(value.bindings.baselineCensusRawSha256, inputs.bridgeEvidence.repeatCensus.sha256, `${phase} authority-delta baseline census hash changed`);
  assert.equal(value.bindings.baselineProgramDataRawSha256, inputs.bridgeEvidence.repeatRaw.sha256, `${phase} authority-delta baseline raw hash changed`);
  assert.equal(value.bindings.currentCensusRawSha256, census.sha256, `${phase} authority-delta census raw hash changed`);
  assert.equal(value.bindings.currentProgramDataRawSha256, currentRaw.sha256, `${phase} authority-delta ProgramData raw hash changed`);
  if (phase === "post-handoff") assert.equal(value.bindings.priorAuthorityDeltaReceiptRawSha256, null);
  else assert.equal(value.bindings.priorAuthorityDeltaReceiptRawSha256, prior.sha256, "post-activation authority-delta prior raw hash changed");
  assertExactKeys(value.target, [
    "programId", "programData", "loader", "reviewedControllerProgramId",
    "legacyUpgradeAuthority", "controllerAuthorityPda",
  ], `${phase} authority-delta target`);
  const [controllerAuthority] = deriveAuthorityPda(CONTROLLER, TARGET);
  assert.deepEqual(value.target, {
    programId: TARGET.toBase58(),
    programData: TARGET_PROGRAMDATA.toBase58(),
    loader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58(),
    reviewedControllerProgramId: CONTROLLER.toBase58(),
    legacyUpgradeAuthority: LEGACY_AUTHORITY.toBase58(),
    controllerAuthorityPda: controllerAuthority.toBase58(),
  }, `${phase} authority-delta target graph changed`);
  const baseline = validateAuthorityDeltaSnapshot(value.baseline, `${phase} authority-delta baseline`);
  const current = validateAuthorityDeltaSnapshot(value.current, `${phase} authority-delta current`);
  assert.equal(baseline.upgradeAuthority, LEGACY_AUTHORITY.toBase58(), `${phase} authority-delta baseline authority changed`);
  assert.equal(current.upgradeAuthority, controllerAuthority.toBase58(), `${phase} authority-delta current authority changed`);
  assert(current.compatibilityObservation.captureStartSlot > baseline.compatibilityObservation.contextSlot, `${phase} authority-delta census did not follow the baseline`);
  assert.deepEqual(current.compatibilityInventory, baseline.compatibilityInventory, `${phase} authority-delta V4 inventory changed`);
  assert.deepEqual(baseline.compatibilityInventory, inputs.bridgeEvidence.repeatReceipt.value.repeat.compatibilityInventory, `${phase} authority-delta baseline inventory differs from Step 8`);
  for (const field of [
    "deployedSlot", "programDataRawBytes", "programDataPayloadCapacityBytes", "programDataPayloadSha256",
    "programExecutablePrefixSha256", "programDataLamports",
  ]) assert.equal(current[field], baseline[field], `${phase} authority-delta changed ${field}`);
  assert.equal(baseline.censusRawSha256, inputs.bridgeEvidence.repeatCensus.sha256);
  assert.equal(baseline.programDataRawSha256, inputs.bridgeEvidence.repeatRaw.sha256);
  assert.equal(current.censusRawSha256, census.sha256);
  assert.equal(current.programDataRawSha256, currentRaw.sha256);
  assertExactKeys(value.authorityDelta, [
    "programDataMetadataBytes", "authorityOptionOffset", "authorityBytesOffset", "authorityBytesLength",
    "changedByteCount", "before", "after", "exactReplacementVerified", "artifactBytes",
    "trailingBytes", "trailingBytesSha256",
  ], `${phase} authority-delta byte proof`);
  assert.equal(value.authorityDelta.programDataMetadataBytes, PROGRAMDATA_HEADER_LEN);
  assert.equal(value.authorityDelta.authorityOptionOffset, 12);
  assert.equal(value.authorityDelta.authorityBytesOffset, 13);
  assert.equal(value.authorityDelta.authorityBytesLength, 32);
  assert.equal(value.authorityDelta.before, LEGACY_AUTHORITY.toBase58());
  assert.equal(value.authorityDelta.after, controllerAuthority.toBase58());
  assert.equal(value.authorityDelta.exactReplacementVerified, true);
  assert.equal(value.authorityDelta.artifactBytes, inputs.artifact.length);
  assert.equal(value.authorityDelta.trailingBytes, current.programDataPayloadCapacityBytes - inputs.artifact.length);
  assert.equal(value.authorityDelta.trailingBytesSha256, sha256Hex(Buffer.alloc(value.authorityDelta.trailingBytes)));
  assertAuthorityDeltaProgramdataBytes(inputs.bridgeEvidence.repeatRaw.bytes, currentRaw.bytes, value);
  assertExactKeys(value.invariants, [
    "programLinkOwnerExecutableUnchanged", "deployedSlotUnchanged", "capacityUnchanged",
    "payloadByteIdentical", "programDataLamportsUnchanged", "featuresUnchanged",
    "programAccountInventoryByteIdentical", "externalReferenceSetByteIdentical",
    "externalAccountInventoryByteIdentical", "allCompatibilityRootsAndCountsIdentical",
    "onlyAuthorityHeaderBytesMayDiffer", "artifactPrefixExact", "zeroTailExact",
    "priorPostHandoffReceiptVerified",
  ], `${phase} authority-delta invariants`);
  for (const [field, result] of Object.entries(value.invariants)) {
    assert.equal(result, field === "priorPostHandoffReceiptVerified" && phase === "post-handoff" ? null : true, `${phase} authority-delta invariant ${field} failed`);
  }
  assertSemanticHash(value, AUTHORITY_DELTA_CENSUS_DOMAIN, "receiptSha256", `${phase} authority-delta receipt`);
  if (phase === "post-activation") {
    assert(current.compatibilityObservation.captureStartSlot > prior.value.current.contextSlot, "post-activation census did not follow the post-handoff census");
    assert.deepEqual(current.compatibilityInventory, prior.value.current.compatibilityInventory, "post-activation V4 inventory differs from post-handoff");
    for (const field of [
      "deployedSlot", "upgradeAuthority", "programDataRawBytes", "programDataPayloadCapacityBytes",
      "programDataRawSha256", "programDataPayloadSha256", "programExecutablePrefixSha256", "programDataLamports",
    ]) assert.equal(current[field], prior.value.current[field], `post-activation authority-delta changed ${field}`);
  }
  return { value, file: receiptFile, bytes: receiptBytes, sha256: sha256Hex(receiptBytes), census, currentRaw };
}

function assertPostActivationAuthorityDelta(inputs, validated) {
  const evidence = inputs.postActivationAuthorityDelta;
  assert(evidence, "post-activation authority-delta census is absent");
  assert(validated.progress.proposal && validated.progress.receipt && validated.progress.deployment, "post-activation census requires completed on-chain activation");
  const executedSlot = Number(validated.progress.proposal.executedSlot);
  assert(Number.isSafeInteger(executedSlot) && executedSlot > 0, "activation executed slot is invalid");
  assert(
    evidence.value.current.compatibilityObservation.captureStartSlot > executedSlot,
    "post-activation authority-delta census did not begin after activation",
  );
  assert(evidence.value.current.contextSlot >= executedSlot, "post-activation authority-delta ProgramData observation predates activation");
  assert.equal(evidence.value.current.programDataRawSha256, sha256Hex(validated.state.targetProgramdata.raw), "post-activation authority-delta ProgramData differs from finalized activation state");
  assert.equal(evidence.value.current.deployedSlot.toString(), validated.state.targetProgramdata.deployedSlot.toString(), "post-activation deployed slot changed");
  assert.equal(evidence.value.current.upgradeAuthority, validated.state.ids.authority.toBase58(), "post-activation target authority changed");
  assert.deepEqual(
    evidence.value.current.compatibilityInventory,
    inputs.postHandoffAuthorityDelta.value.current.compatibilityInventory,
    "post-activation V4 inventory differs from post-handoff",
  );
  return evidence;
}

function originCommitment(origin) {
  return hashBytes(
    Buffer.from("AMOEBA_DEVNET_RPC_PROVIDER_ORIGIN_V1", "ascii"),
    Buffer.from(origin, "utf8"),
  ).toString("hex");
}

function fileInRunDir(runDir, name) {
  const result = path.resolve(runDir, name);
  assert.equal(path.dirname(result), path.resolve(runDir), `${name} escaped the ceremony run directory`);
  return result;
}

function activationJournalName(operation) {
  assertLowerHash(operation, "activation operation ID");
  return `${ACTIVATION_JOURNAL_NAME}-${operation}`;
}

function activationPlanningJournalName(operation) {
  assertLowerHash(operation, "activation planning operation ID");
  return `${ACTIVATION_PLANNING_JOURNAL_NAME}-${operation}`;
}

function publicKey(value, label) {
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`${label} is not a public key`);
  }
}

function accountFingerprint(account) {
  if (account === null) return null;
  return {
    owner: account.owner.toBase58(),
    executable: account.executable,
    dataBytes: account.data.length,
    dataSha256: sha256Hex(account.data),
  };
}

function instructionManifest(instruction) {
  return {
    programId: instruction.programId.toBase58(),
    accounts: instruction.keys.map((meta) => ({
      pubkey: meta.pubkey.toBase58(),
      isSigner: meta.isSigner,
      isWritable: meta.isWritable,
    })),
    dataBytes: instruction.data.length,
    dataHex: Buffer.from(instruction.data).toString("hex"),
    dataSha256: sha256Hex(instruction.data),
  };
}

function computePrefix() {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_UNIT_PRICE }),
  ];
}

function envelope() {
  return {
    computeUnitLimit: COMPUTE_UNIT_LIMIT,
    computeUnitPriceMicroLamports: COMPUTE_UNIT_PRICE,
    durableNonceAccount: { present: false, value: PublicKey.default },
    durableNonceAuthority: { present: false, value: PublicKey.default },
  };
}

function normalizedPacket(instructions, expectedSignerKeys) {
  const message = new TransactionMessage({
    payerKey: PAYER,
    recentBlockhash: EXPECTED_GENESIS,
    instructions,
  }).compileToV0Message();
  const signers = message.staticAccountKeys
    .slice(0, message.header.numRequiredSignatures)
    .map((entry) => entry.toBase58());
  assert.deepEqual(signers, expectedSignerKeys.map((entry) => entry.toBase58()), "transaction signer order changed");
  const transaction = new VersionedTransaction(message);
  const wire = Buffer.from(transaction.serialize());
  assert(wire.length <= MAX_PACKET_BYTES, "planned transaction exceeds the Solana packet limit");
  return {
    expectedSigners: signers,
    normalizedMessageSha256: sha256Hex(Buffer.from(message.serialize())),
    packetBytes: wire.length,
    instructions: instructions.map(instructionManifest),
  };
}

function assertAccount(account, owner, length, label, executable = false) {
  assert(account, `${label} is absent`);
  assert(account.owner.equals(owner), `${label} owner changed`);
  assert.equal(account.data.length, length, `${label} length changed`);
  assert.equal(account.executable, executable, `${label} executable flag changed`);
  return account;
}

function assertVacant(account, label) {
  if (account === null) return;
  assert(account.owner.equals(SystemProgram.programId), `${label} is foreign-owned`);
  assert.equal(account.data.length, 0, `${label} is data-bearing`);
  assert.equal(account.executable, false, `${label} is executable`);
}

function parseProgramAccount(account, expectedProgramdata, label) {
  assertAccount(account, BPF_LOADER_UPGRADEABLE_PROGRAM_ID, PROGRAM_ACCOUNT_LEN, label, true);
  assert.equal(account.data.readUInt32LE(0), 2, `${label} is not a Loader-v3 Program`);
  assert(new PublicKey(account.data.subarray(4, 36)).equals(expectedProgramdata), `${label} linkage changed`);
}

function parseProgramdataAccount(account, label) {
  assert(account, `${label} is absent`);
  assert(account.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), `${label} owner changed`);
  assert.equal(account.executable, false, `${label} is executable`);
  assert(account.data.length >= PROGRAMDATA_HEADER_LEN, `${label} is truncated`);
  assert.equal(account.data.readUInt32LE(0), 3, `${label} is not Loader-v3 ProgramData`);
  const option = account.data[12];
  assert(option === 0 || option === 1, `${label} authority option is malformed`);
  let authority = null;
  if (option === 1) authority = new PublicKey(account.data.subarray(13, 45));
  // Loader-v3 may retain stale bytes after the Option tag is cleared.  The
  // canonical authority is the tag, while the exact raw header remains bound
  // separately by observations and receipts.
  return {
    raw: Buffer.from(account.data),
    header: Buffer.from(account.data.subarray(0, PROGRAMDATA_HEADER_LEN)),
    payload: Buffer.from(account.data.subarray(PROGRAMDATA_HEADER_LEN)),
    deployedSlot: account.data.readBigUInt64LE(4),
    authority,
  };
}

function postHandoffRaw(preRaw, controllerAuthority) {
  const result = Buffer.from(preRaw);
  assert.equal(result[12], 1, "pre-handoff ProgramData authority is absent");
  result[12] = 1;
  controllerAuthority.toBuffer().copy(result, 13);
  return result;
}

function compareOptionalKey(actual, expected, label) {
  assert.equal(actual.present, expected !== null, `${label} presence changed`);
  assert(actual.value.equals(expected ?? PublicKey.default), `${label} value changed`);
}

async function readSecureEvidence(name, environment) {
  const file = await requireSecureRegularFile(requiredEnvironment(environment), `${name} evidence`);
  const bytes = await readFile(file);
  assert(bytes.length > 0, `${name} evidence is empty`);
  return { bytes, file, sha256: sha256Hex(bytes) };
}

async function readInputs({ rpc = true } = {}) {
  const runDir = await requireSecureDirectory(requiredEnvironment("AMEBA_CEREMONY_RUN_DIR"), "ceremony run directory");
  const bridgeRunDir = await requireSecureDirectory(
    requiredEnvironment("AMEBA_SPREAD_BRIDGE_RUN_DIR"),
    "Spread bridge run directory",
  );
  const artifactFile = await requireSecureRegularFile(requiredEnvironment("AMEBA_SPREAD_BRIDGE_ARTIFACT"), "Spread bridge artifact");
  const artifact = await readFile(artifactFile);
  assert(artifact.length > 0 && artifact.length <= MAX_ARTIFACT_BYTES_V1, "Spread bridge artifact length is outside Release 1 bounds");
  const artifactSha256 = sha256Hex(artifact);
  const artifactMerkle = artifactMerkleRoot(artifact, RELEASE1_ARTIFACT_CHUNK_SIZE_V1);
  const source = await readSecureEvidence("Spread source", "AMEBA_SPREAD_BRIDGE_SOURCE_EVIDENCE");
  const buildInputs = await readSecureEvidence("Spread build inputs", "AMEBA_SPREAD_BRIDGE_BUILD_INPUTS_EVIDENCE");
  const packageReceipt = await readSecureEvidence("Spread package", "AMEBA_SPREAD_BRIDGE_PACKAGE_EVIDENCE");
  const releaseManifest = await readSecureEvidence("Spread release manifest", "AMEBA_SPREAD_BRIDGE_RELEASE_MANIFEST");
  const phase3ManifestEvidence = await readSecureEvidence("Phase 3 instruction manifest", "AMEBA_SPREAD_PHASE3_INSTRUCTION_MANIFEST");
  assert.equal(path.basename(source.file), CEREMONY_BUILD_RECEIPT_FILE, "Spread source evidence is not the canonical ceremony build receipt");
  assert.equal(path.basename(buildInputs.file), CEREMONY_BUILD_INVENTORY_FILE, "Spread build-input evidence is not the canonical build inventory");
  assert.equal(path.basename(packageReceipt.file), POSTSTATE_REPEAT_RECEIPT_FILE, "Spread package evidence is not the canonical repeat census receipt");
  assert.equal(path.basename(releaseManifest.file), RELEASE_MANIFEST_FILE, "Spread release-manifest basename changed");
  assert.equal(path.basename(phase3ManifestEvidence.file), PHASE3_INSTRUCTION_MANIFEST_FILE, "Phase 3 instruction manifest basename changed");
  const buildReceipt = validateCeremonyBuildReceiptLineage(
    parseCanonicalJson(source.bytes, "Spread bridge ceremony build receipt", { sorted: false }),
    source.bytes,
    artifactSha256,
    artifact.length,
  );
  const buildInventory = validateCeremonyBuildInventory(
    parseCanonicalJson(buildInputs.bytes, "Spread bridge ceremony build inventory"),
    buildInputs.bytes,
  );
  const phase3Manifest = validatePhase3InstructionManifest(
    parseCanonicalJson(phase3ManifestEvidence.bytes, "Phase 3 instruction manifest", { sorted: null }),
    phase3ManifestEvidence.bytes,
  );
  assert.equal(buildReceipt.inputs.sha256, buildInputs.sha256, "build receipt does not bind the supplied build inventory");
  assert.equal(buildReceipt.inputs.aggregateSha256, buildInventory.value.summary.aggregateSha256, "build receipt inventory aggregate changed");
  assert.equal(buildReceipt.inputs.fileCount, buildInventory.value.summary.fileCount, "build receipt inventory count changed");
  assert.equal(buildReceipt.source.commit, buildInventory.value.git.head, "build receipt and inventory commits differ");
  const manifestInventoryRecord = buildInventory.byPath.get(PHASE3_INSTRUCTION_MANIFEST_REPOSITORY_PATH);
  assert(manifestInventoryRecord, "build inventory omits the canonical Phase 3 instruction manifest");
  assert.equal(manifestInventoryRecord.sha256, phase3ManifestEvidence.sha256, "Phase 3 instruction manifest bytes differ from the tagged build input");
  assert.equal(manifestInventoryRecord.sizeBytes, phase3ManifestEvidence.bytes.length, "Phase 3 instruction manifest size differs from the tagged build input");
  const manifest = parseCanonicalJson(releaseManifest.bytes, "Spread bridge release manifest");
  const manifestKeys = [
    "schema", "mainnetAllowed", "productionUseAuthorized", "clusterGenesis", "controllerProgram",
    "controllerConfig", "protocolGate", "targetProgram", "targetProgramdata", "legacyAuthority",
    "controllerAuthority", "artifactBytes", "artifactSha256", "sourceEvidenceSha256",
    "buildInputsEvidenceSha256", "packageEvidenceSha256",
  ];
  assertExactKeys(manifest, manifestKeys, "Spread bridge release manifest");
  assert.equal(manifest.schema, "ameba-spread-devnet-bridge-release-manifest-v1");
  assert.equal(manifest.mainnetAllowed, false);
  assert.equal(manifest.productionUseAuthorized, true);
  assert.equal(manifest.clusterGenesis, EXPECTED_GENESIS);
  assert.equal(manifest.controllerProgram, CONTROLLER.toBase58());
  const [manifestConfig] = deriveControllerConfigPda(CONTROLLER, TARGET);
  const [manifestAuthority] = deriveAuthorityPda(CONTROLLER, TARGET);
  const [manifestGate] = deriveGatePda(CONTROLLER, TARGET);
  assert.equal(manifest.controllerConfig, manifestConfig.toBase58(), "Spread release manifest controller config changed");
  assert.equal(manifest.protocolGate, manifestGate.toBase58(), "Spread release manifest gate changed");
  assert.equal(manifest.targetProgram, TARGET.toBase58());
  assert.equal(manifest.targetProgramdata, TARGET_PROGRAMDATA.toBase58());
  assert.equal(manifest.legacyAuthority, LEGACY_AUTHORITY.toBase58());
  assert.equal(manifest.controllerAuthority, manifestAuthority.toBase58(), "Spread release manifest controller authority changed");
  assert.equal(manifest.artifactBytes, artifact.length);
  assert.equal(manifest.artifactSha256, artifactSha256);
  assert.equal(manifest.sourceEvidenceSha256, source.sha256);
  assert.equal(manifest.buildInputsEvidenceSha256, buildInputs.sha256);
  assert.equal(manifest.packageEvidenceSha256, packageReceipt.sha256);
  const base = {
    runDir,
    bridgeRunDir,
    artifact,
    artifactFile,
    artifactSha256,
    artifactMerkle,
    evidence: {
      source, buildInputs, packageReceipt, releaseManifest, manifest,
      buildReceipt, buildInventory, phase3ManifestEvidence, phase3Manifest,
    },
  };
  const bridgeEvidence = await readBridgeEvidence(bridgeRunDir, base);
  assertReleaseEvidenceLineage(base, bridgeEvidence);
  const frozenGateCensus = await loadFrozenGateCensus(runDir, base, { optional: true });
  const rpcConfiguration = rpc ? await loadDevnetRpcConfiguration() : null;
  return { ...base, bridgeEvidence, frozenGateCensus, rpcConfiguration };
}

function assertLowerHash(value, label) {
  assert(typeof value === "string" && /^[0-9a-f]{64}$/u.test(value), `${label} is not lowercase SHA-256`);
  assert.notEqual(value, "0".repeat(64), `${label} is zero`);
}

function assertSemanticHash(value, domain, field, label) {
  assertLowerHash(value[field], `${label} ${field}`);
  assert.equal(value[field], semanticJsonHash(domain, value, field), `${label} semantic hash changed`);
}

function assertPublicKeyField(value, field, expected, label) {
  const key = publicKey(value[field], `${label} ${field}`);
  if (expected) assert(key.equals(expected), `${label} ${field} changed`);
  return key;
}

async function readRunFile(runDir, basename, label) {
  const file = await requireSecureRegularFile(fileInRunDir(runDir, basename), label);
  const bytes = await readFile(file);
  assert(bytes.length > 0, `${label} is empty`);
  return { file, bytes, sha256: sha256Hex(bytes) };
}

function validateBridgeUpgradeReceipt(value, raw, inputs) {
  assertExactKeys(value, BRIDGE_UPGRADE_RECEIPT_KEYS, "reviewed bridge upgrade receipt");
  assert.equal(value.schema, BRIDGE_UPGRADE_RECEIPT_SCHEMA, "bridge receipt schema changed");
  assert.equal(value.genesisHash, EXPECTED_GENESIS, "bridge receipt genesis changed");
  assert.equal(value.targetProgram, TARGET.toBase58(), "bridge receipt target changed");
  assert.equal(value.targetProgramdata, TARGET_PROGRAMDATA.toBase58(), "bridge receipt ProgramData changed");
  assert.equal(value.loader, BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58(), "bridge receipt loader changed");
  assert.equal(value.legacyUpgradeAuthority, LEGACY_AUTHORITY.toBase58(), "bridge receipt legacy authority changed");
  assert.equal(value.postUpgradeAuthority, LEGACY_AUTHORITY.toBase58(), "bridge receipt post-upgrade authority changed");
  assert.equal(value.canonicalSpill, TREASURY.toBase58(), "bridge receipt spill changed");
  assertPublicKeyField(value, "primaryBuffer", null, "bridge receipt");
  assertPublicKeyField(value, "formerAuthorityProofBuffer", null, "bridge receipt");
  assert.notEqual(value.primaryBuffer, value.formerAuthorityProofBuffer, "bridge primary and proof buffers alias");
  for (const field of [
    "operationId", "planSha256", "compatibilityAdapterSha256",
    "planningCompatibilitySummaryRawSha256", "preSignCompatibilitySummaryRawSha256",
    "preSignCapacityReportRawSha256", "primaryBufferEvidenceRawSha256",
    "postCompatibilitySummaryRawSha256", "authoritativeUpgradeReceiptRawSha256",
    "authoritativePostProgramDataRawSha256", "artifactSha256", "postProgramDataRawSha256",
    "postProgramDataPayloadSha256", "deployedArtifactSha256", "trailingBytesSha256",
    "formerAuthorityProofBufferRawSha256",
  ]) assertLowerHash(value[field], `bridge receipt ${field}`);
  assert.equal(
    value.compatibilityAdapterSha256,
    EXPECTED_HISTORICAL_BRIDGE_RECEIPT_ADAPTER_SHA256,
    "bridge receipt does not bind the frozen poststate-repeat adapter",
  );
  assert.equal(value.artifactBytes, inputs.artifact.length, "bridge receipt artifact length changed");
  assert.equal(value.artifactSha256, inputs.artifactSha256, "bridge receipt artifact hash changed");
  assert.equal(value.deployedArtifactSha256, inputs.artifactSha256, "bridge receipt deployed artifact changed");
  assertSignature(value.transactionSignature, "bridge receipt transaction signature");
  for (const field of ["transactionSlot", "finalizedContextSlot", "postDeployedSlot"]) {
    assertSafeInteger(value[field], `bridge receipt ${field}`, 1);
  }
  for (const field of ["artifactBytes", "postCapacityBytes", "trailingBytes"]) {
    assertSafeInteger(value[field], `bridge receipt ${field}`);
  }
  assert(value.finalizedContextSlot >= value.transactionSlot, "bridge finalized context predates its transaction");
  assert.equal(value.postDeployedSlot, value.transactionSlot, "bridge deployed slot differs from transaction slot");
  assert.equal(value.topLevelInstructionCount, 1, "bridge top-level envelope is not singular");
  assert.equal(value.loaderUpgradeInstructionCount, 1, "bridge loader Upgrade count changed");
  assert.equal(value.siblingInstructionCount, 0, "bridge receipt admits sibling instructions");
  assert.equal(value.extensionInstructionCount, 0, "bridge upgrade transaction contains extension");
  assert.equal(value.postCapacityBytes >= value.artifactBytes, true, "bridge artifact exceeds ProgramData capacity");
  assert.equal(value.trailingBytes, value.postCapacityBytes - value.artifactBytes, "bridge tail length changed");
  assert.equal(value.trailingBytesSha256, sha256Hex(Buffer.alloc(value.trailingBytes)), "bridge zero-tail hash changed");
  assert.equal(value.trailingBytesAllZero, true, "bridge tail is not zero");
  assert.equal(value.primaryBufferClosed, true, "bridge primary buffer was not closed");
  assert.equal(value.formerAuthorityProofBufferPreserved, true, "bridge proof buffer was not preserved");
  assertCanonicalBasename(value.authoritativePostSummaryFile, FIRST_POST_FILE_PATTERN, "bridge post summary filename");
  assertCanonicalBasename(value.authoritativeUpgradeReceiptFile, FIRST_POST_FILE_PATTERN, "bridge upgrade receipt filename");
  assertCanonicalBasename(value.authoritativePostProgramDataRawFile, FIRST_POST_FILE_PATTERN, "bridge post ProgramData filename");
  assert.equal(value.receiptSha256, bridgeUpgradeReceiptHash(value), "bridge receipt semantic hash changed");
  assert.equal(raw.length > 0, true);
}

function validateFirstPostSummary(value, raw, wrapper, inputs, postRaw) {
  assertExactKeys(value, FIRST_POST_SUMMARY_KEYS, "first post-upgrade summary");
  assert.equal(value.schema, FIRST_POST_SUMMARY_SCHEMA, "first post summary schema changed");
  assert.equal(value.schemaVersion, 1, "first post summary version changed");
  assert.equal(value.phase, "post-upgrade", "first post summary phase changed");
  assert.equal(
    value.evidenceMode,
    "completed-v2-upgrade-verifier-with-full-v3-v4-recapture-and-history",
    "first post summary evidence mode changed",
  );
  for (const field of [
    "planningSummaryRawSha256", "preSignSummaryRawSha256", "buildReceiptRawSha256",
  ]) assertLowerHash(value[field], `first post summary ${field}`);
  assert.equal(value.planningSummaryRawSha256, wrapper.planningCompatibilitySummaryRawSha256, "first post planning summary binding changed");
  assert.equal(value.preSignSummaryRawSha256, wrapper.preSignCompatibilitySummaryRawSha256, "first post pre-sign summary binding changed");

  assertExactKeys(value.controller, [
    "programId", "programData", "configPda", "gatePda", "artifactSha256",
    "programDataRawSha256", "immutabilityReceiptSha256", "upgradeAuthority",
  ], "first post controller");
  const [expectedConfig] = deriveControllerConfigPda(CONTROLLER, TARGET);
  const [expectedGate] = deriveGatePda(CONTROLLER, TARGET);
  assert.equal(value.controller.programId, CONTROLLER.toBase58(), "first post controller Program changed");
  assert.equal(value.controller.programData, CONTROLLER_PROGRAMDATA.toBase58(), "first post controller ProgramData changed");
  assert.equal(value.controller.configPda, expectedConfig.toBase58(), "first post controller config changed");
  assert.equal(value.controller.gatePda, expectedGate.toBase58(), "first post gate changed");
  for (const field of ["artifactSha256", "programDataRawSha256", "immutabilityReceiptSha256"]) {
    assertLowerHash(value.controller[field], `first post controller ${field}`);
  }
  assert.equal(value.controller.upgradeAuthority, null, "first post controller is not immutable");

  assertExactKeys(value.target, ["programId", "programData", "upgradeableLoader", "upgradeAuthority"], "first post target");
  assert.equal(value.target.programId, TARGET.toBase58(), "first post target Program changed");
  assert.equal(value.target.programData, TARGET_PROGRAMDATA.toBase58(), "first post target ProgramData changed");
  assert.equal(value.target.upgradeableLoader, BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58(), "first post target loader changed");
  assert.equal(value.target.upgradeAuthority, LEGACY_AUTHORITY.toBase58(), "first post target authority changed");

  assertExactKeys(value.artifact, ["sha256", "sizeBytes", "programDataCapacityBytes"], "first post artifact");
  assert.deepEqual(value.artifact, {
    sha256: inputs.artifactSha256,
    sizeBytes: inputs.artifact.length,
    programDataCapacityBytes: wrapper.postCapacityBytes,
  }, "first post artifact identity changed");

  assertExactKeys(value.prestate, [
    "jsonRawSha256", "rawSha256", "contextSlot", "deployedSlot", "programDataRawBytes",
    "programDataPayloadCapacityBytes", "programDataPayloadSha256",
    "programExecutablePrefixSha256", "capacityReportRawSha256", "capacityReportSha256",
    "compatibilityObservation", "compatibilityInventory",
  ], "first post prestate");
  for (const field of [
    "jsonRawSha256", "rawSha256", "programDataPayloadSha256", "programExecutablePrefixSha256",
    "capacityReportRawSha256", "capacityReportSha256",
  ]) assertLowerHash(value.prestate[field], `first post prestate ${field}`);
  assert.equal(value.prestate.capacityReportRawSha256, wrapper.preSignCapacityReportRawSha256, "first post capacity report changed");
  for (const field of ["contextSlot", "deployedSlot", "programDataRawBytes", "programDataPayloadCapacityBytes"]) {
    assertSafeInteger(value.prestate[field], `first post prestate ${field}`, 1);
  }
  assert.equal(value.prestate.programDataPayloadCapacityBytes, wrapper.postCapacityBytes, "first post prestate capacity changed");
  assertExactKeys(value.prestate.compatibilityObservation, [
    "captureStartSlot", "programInventoryVerifiedSlot", "contextSlot",
  ], "first post prestate compatibility observation");
  for (const field of ["captureStartSlot", "programInventoryVerifiedSlot", "contextSlot"]) {
    assertSafeInteger(value.prestate.compatibilityObservation[field], `first post prestate observation ${field}`, 1);
  }
  assert(value.prestate.compatibilityObservation.captureStartSlot <= value.prestate.compatibilityObservation.contextSlot, "first post prestate census slots are reversed");
  assert(value.prestate.compatibilityObservation.programInventoryVerifiedSlot <= value.prestate.compatibilityObservation.contextSlot, "first post prestate inventory verification follows its context");
  const preInventory = validateCompatibilityInventory(value.prestate.compatibilityInventory, "first post prestate inventory");

  assertExactKeys(value.upgrade, [
    "receiptRawSha256", "receiptSha256", "transactionSignature", "transactionSlot",
    "finalizedContextSlot", "bufferAddress", "spillAddress", "oneExactUpgradeableLoaderUpgrade",
    "noSiblingMutation", "historyWindowVerified",
  ], "first post upgrade");
  for (const field of ["receiptRawSha256", "receiptSha256"]) assertLowerHash(value.upgrade[field], `first post upgrade ${field}`);
  assert.equal(value.upgrade.receiptRawSha256, wrapper.authoritativeUpgradeReceiptRawSha256, "first post authoritative receipt hash changed");
  assertSignature(value.upgrade.transactionSignature, "first post transaction signature");
  assert.equal(value.upgrade.transactionSignature, wrapper.transactionSignature, "first post transaction changed");
  assert.equal(value.upgrade.transactionSlot, wrapper.transactionSlot, "first post transaction slot changed");
  assert(
    value.upgrade.finalizedContextSlot >= wrapper.finalizedContextSlot,
    "first post finalized context predates the bridge wrapper",
  );
  assert.equal(value.upgrade.bufferAddress, wrapper.primaryBuffer, "first post primary buffer changed");
  assert.equal(value.upgrade.spillAddress, wrapper.canonicalSpill, "first post spill changed");
  assert.equal(value.upgrade.oneExactUpgradeableLoaderUpgrade, true, "first post lacks one exact Loader Upgrade");
  assert.equal(value.upgrade.noSiblingMutation, true, "first post admits sibling mutation");
  assert.equal(value.upgrade.historyWindowVerified, true, "first post history window is unverified");

  assertExactKeys(value.poststate, [
    "programDataRawSha256", "programDataRawBytes", "programDataPayloadCapacityBytes",
    "programDataPayloadSha256", "deployedArtifactSha256", "deployedSlot", "upgradeAuthority",
    "trailingBytes", "trailingBytesSha256", "trailingBytesAllZero",
    "compatibilityReceiptSha256", "compatibilityInventory", "exactInventoryPreserved",
  ], "first post state");
  for (const field of [
    "programDataRawSha256", "programDataPayloadSha256", "deployedArtifactSha256",
    "trailingBytesSha256", "compatibilityReceiptSha256",
  ]) assertLowerHash(value.poststate[field], `first post state ${field}`);
  assert.equal(value.poststate.programDataRawSha256, wrapper.postProgramDataRawSha256, "first post raw hash changed");
  assert.equal(value.poststate.programDataRawSha256, wrapper.authoritativePostProgramDataRawSha256, "first post authoritative raw hash changed");
  assert.equal(value.poststate.programDataPayloadSha256, wrapper.postProgramDataPayloadSha256, "first post payload hash changed");
  assert.equal(value.poststate.deployedArtifactSha256, inputs.artifactSha256, "first post deployed artifact changed");
  assert.equal(value.poststate.deployedSlot, wrapper.postDeployedSlot, "first post deployed slot changed");
  assert.equal(value.poststate.upgradeAuthority, LEGACY_AUTHORITY.toBase58(), "first post authority changed");
  assert.equal(value.poststate.programDataRawBytes, PROGRAMDATA_HEADER_LEN + wrapper.postCapacityBytes, "first post raw length changed");
  assert.equal(value.poststate.programDataPayloadCapacityBytes, wrapper.postCapacityBytes, "first post capacity changed");
  assert.equal(value.poststate.trailingBytes, wrapper.trailingBytes, "first post tail length changed");
  assert.equal(value.poststate.trailingBytesSha256, wrapper.trailingBytesSha256, "first post tail hash changed");
  assert.equal(value.poststate.trailingBytesAllZero, true, "first post tail is nonzero");
  assert.equal(value.poststate.exactInventoryPreserved, true, "first post inventory was not preserved");
  const postInventory = validateCompatibilityInventory(value.poststate.compatibilityInventory, "first post inventory");
  assert.deepEqual(postInventory, preInventory, "first post exact inventory changed");

  assert.equal(postRaw.length, PROGRAMDATA_HEADER_LEN + wrapper.postCapacityBytes, "authoritative post ProgramData length changed");
  assert.equal(postRaw.readUInt32LE(0), 3, "authoritative post snapshot is not ProgramData");
  assert.equal(postRaw.readBigUInt64LE(4), BigInt(wrapper.postDeployedSlot), "authoritative post deployed slot changed");
  assert.equal(postRaw[12], 1, "authoritative post authority is absent");
  assert(new PublicKey(postRaw.subarray(13, 45)).equals(LEGACY_AUTHORITY), "authoritative post authority changed");
  const payload = postRaw.subarray(PROGRAMDATA_HEADER_LEN);
  assert(payload.subarray(0, inputs.artifact.length).equals(inputs.artifact), "authoritative post artifact bytes changed");
  const tail = payload.subarray(inputs.artifact.length);
  assert.equal(tail.length, wrapper.trailingBytes, "authoritative post tail length changed");
  assert.equal(tail.some((byte) => byte !== 0), false, "authoritative post tail is nonzero");
  assert.equal(sha256Hex(postRaw), value.poststate.programDataRawSha256, "authoritative post raw hash changed");
  assert.equal(sha256Hex(payload), value.poststate.programDataPayloadSha256, "authoritative post payload hash changed");
  assert.equal(sha256Hex(tail), value.poststate.trailingBytesSha256, "authoritative post tail hash changed");

  assertSemanticHash(value, FIRST_POST_SUMMARY_DOMAIN, "summarySha256", "first post summary");
  assert.equal(sha256Hex(raw), wrapper.postCompatibilitySummaryRawSha256, "first post summary raw hash changed");
  return { preInventory, postInventory };
}

function validateAuthoritativeUpgradeReceipt(value, wrapper, summary, inputs) {
  assertExactKeys(value, UPGRADE_RECEIPT_KEYS, "authoritative upgrade receipt");
  assert.equal(value.schemaVersion, 2, "authoritative upgrade receipt version changed");
  assert.equal(value.kind, "ameba-spread-programdata-upgrade-receipt", "authoritative upgrade receipt kind changed");
  assert.equal(value.ok, true, "authoritative upgrade receipt is not successful");
  assert.equal(value.programId, TARGET.toBase58(), "authoritative upgrade receipt Program changed");
  assert.equal(value.programDataAddress, TARGET_PROGRAMDATA.toBase58(), "authoritative upgrade receipt ProgramData changed");
  assert.equal(value.loaderProgramId, BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58(), "authoritative upgrade receipt loader changed");
  assert.equal(value.genesisHash, EXPECTED_GENESIS, "authoritative upgrade receipt genesis changed");
  assert.equal(value.bufferAddress, wrapper.primaryBuffer, "authoritative upgrade buffer changed");
  assert.equal(value.spillAddress, TREASURY.toBase58(), "authoritative upgrade spill changed");
  assert.equal(value.upgradeAuthority, LEGACY_AUTHORITY.toBase58(), "authoritative upgrade authority changed");
  for (const field of [
    "programDataCapacityEvidenceSha256", "bufferPrestateReceiptSha256",
    "upgradeCompatibilityPrestateSha256", "postUpgradeCompatibilitySha256", "buildReceiptSha256",
    "artifactSha256", "programDataPayloadSha256", "deployedArtifactSha256",
    "trailingBytesSha256",
  ]) assertLowerHash(value[field], `authoritative upgrade receipt ${field}`);
  assert.equal(value.artifactSha256, inputs.artifactSha256, "authoritative receipt artifact changed");
  assert.equal(value.deployedArtifactSha256, inputs.artifactSha256, "authoritative deployed artifact changed");
  assert.equal(value.artifactSizeBytes, inputs.artifact.length, "authoritative artifact length changed");
  assert.equal(value.transactionSignature, wrapper.transactionSignature, "authoritative transaction changed");
  assertSignature(value.transactionSignature, "authoritative transaction signature");
  assert.equal(value.transactionSlot, wrapper.transactionSlot, "authoritative transaction slot changed");
  assert(
    value.finalizedContextSlot >= wrapper.finalizedContextSlot,
    "authoritative finalized context predates the bridge wrapper",
  );
  assert.equal(value.finalizedContextSlot, summary.upgrade.finalizedContextSlot, "authoritative finalized context changed");
  assert.equal(value.deployedSlot, wrapper.postDeployedSlot, "authoritative deployed slot changed");
  assert.equal(value.programDataRawBytes, PROGRAMDATA_HEADER_LEN + wrapper.postCapacityBytes, "authoritative raw length changed");
  assert.equal(value.programDataPayloadCapacityBytes, wrapper.postCapacityBytes, "authoritative capacity changed");
  assert.equal(value.programDataPayloadSha256, wrapper.postProgramDataPayloadSha256, "authoritative payload hash changed");
  assert.equal(value.trailingBytes, wrapper.trailingBytes, "authoritative tail length changed");
  assert.equal(value.trailingBytesSha256, wrapper.trailingBytesSha256, "authoritative tail hash changed");
  assert.equal(value.trailingBytesAllZero, true, "authoritative tail is not zero");
  assert.equal(value.preservedProgramLinkOwnerExecutableAndAuthority, true, "authoritative identity preservation failed");
  assert.equal(value.preservedCompatibleCurrentState, true, "authoritative state preservation failed");
  assert.equal(value.postUpgradeCompatibilitySha256, summary.poststate.compatibilityReceiptSha256, "authoritative compatibility receipt changed");
  assert.equal(value.buildReceiptSha256, summary.buildReceiptRawSha256, "authoritative build receipt changed");
  if (value.programDataCapacityEvidenceKind === "finalized-prestate-no-extension") {
    assert.equal(value.extensionReceiptSha256, null, "zero-delta upgrade has an extension receipt");
    assert.equal(value.extensionTransactionSignature, null, "zero-delta upgrade has an extension signature");
  } else {
    assert.equal(value.programDataCapacityEvidenceKind, "finalized-extension-receipt", "capacity evidence kind changed");
    assertLowerHash(value.extensionReceiptSha256, "authoritative extension receipt");
    assertSignature(value.extensionTransactionSignature, "authoritative extension transaction");
    assert.equal(value.programDataCapacityEvidenceSha256, value.extensionReceiptSha256, "extension capacity evidence changed");
  }
  assertSemanticHash(value, UPGRADE_RECEIPT_DOMAIN, "receiptSha256", "authoritative upgrade receipt");
  assert.equal(value.receiptSha256, summary.upgrade.receiptSha256, "first summary upgrade semantic hash changed");
}

function validateRepeatReceipt(value, wrapper, summary, upgradeReceipt, inputs, files) {
  assertExactKeys(value, POSTSTATE_REPEAT_RECEIPT_KEYS, "poststate repeat receipt");
  assert.equal(value.schema, POSTSTATE_REPEAT_RECEIPT_SCHEMA, "poststate repeat schema changed");
  assert.equal(value.schemaVersion, 1, "poststate repeat version changed");
  assert.equal(value.kind, "ameba-spread-governance-bridge-poststate-repeat", "poststate repeat kind changed");
  assert.equal(value.evidenceMode, "second-independent-finalized-active-state-v4-census", "poststate repeat mode changed");

  assertExactKeys(value.evidenceFiles, [
    "bridgeUpgradeReceipt", "firstPostSummary", "firstUpgradeReceipt",
    "firstPostProgramDataRaw", "repeatCensus", "repeatProgramDataRaw", "repeatReceipt",
  ], "poststate repeat evidence files");
  assert.equal(value.evidenceFiles.bridgeUpgradeReceipt, BRIDGE_UPGRADE_RECEIPT_FILE, "repeat bridge receipt filename changed");
  assert.equal(value.evidenceFiles.firstPostSummary, wrapper.authoritativePostSummaryFile, "repeat first summary filename changed");
  assert.equal(value.evidenceFiles.firstUpgradeReceipt, wrapper.authoritativeUpgradeReceiptFile, "repeat first upgrade receipt filename changed");
  assert.equal(value.evidenceFiles.firstPostProgramDataRaw, wrapper.authoritativePostProgramDataRawFile, "repeat first ProgramData filename changed");
  assert.equal(value.evidenceFiles.repeatReceipt, POSTSTATE_REPEAT_RECEIPT_FILE, "repeat receipt filename changed");
  const censusMatch = assertCanonicalBasename(value.evidenceFiles.repeatCensus, POSTSTATE_REPEAT_CENSUS_PATTERN, "repeat census filename");
  const repeatRawMatch = assertCanonicalBasename(value.evidenceFiles.repeatProgramDataRaw, POSTSTATE_REPEAT_RAW_PATTERN, "repeat ProgramData filename");
  assert.equal(censusMatch[1], repeatRawMatch[1], "repeat evidence attempts differ");

  assertExactKeys(value.build, [
    "receiptRawSha256", "sourceCommit", "sourceTree", "prebuildPlanRawSha256",
    "inputInventoryRawSha256", "inputInventoryAggregateSha256",
  ], "poststate repeat build");
  for (const field of [
    "receiptRawSha256", "prebuildPlanRawSha256", "inputInventoryRawSha256",
    "inputInventoryAggregateSha256",
  ]) assertLowerHash(value.build[field], `poststate repeat build ${field}`);
  assert.equal(value.build.receiptRawSha256, summary.buildReceiptRawSha256, "repeat build receipt changed");
  for (const field of ["sourceCommit", "sourceTree"]) {
    assert(typeof value.build[field] === "string" && /^[0-9a-f]{40}$/u.test(value.build[field]), `repeat build ${field} is malformed`);
  }
  assert.deepEqual(value.controller, summary.controller, "repeat controller changed");
  assert.deepEqual(value.target, summary.target, "repeat target changed");
  assert.deepEqual(value.artifact, summary.artifact, "repeat artifact changed");

  assertExactKeys(value.firstPost, [
    "bridgeUpgradeReceiptRawSha256", "bridgeUpgradeReceiptSha256", "postSummaryRawSha256",
    "postSummarySha256", "upgradeReceiptRawSha256", "upgradeReceiptSha256",
    "postProgramDataRawSha256", "transactionSignature", "transactionSlot",
    "finalizedContextSlot", "programDataRawBytes", "programDataPayloadCapacityBytes",
    "programDataPayloadSha256", "deployedArtifactSha256", "deployedSlot", "upgradeAuthority",
    "trailingBytes", "trailingBytesSha256", "trailingBytesAllZero",
    "compatibilityReceiptSha256", "compatibilityInventory", "compatibilityInventorySha256",
  ], "poststate repeat first post");
  for (const field of [
    "bridgeUpgradeReceiptRawSha256", "bridgeUpgradeReceiptSha256", "postSummaryRawSha256",
    "postSummarySha256", "upgradeReceiptRawSha256", "upgradeReceiptSha256",
    "postProgramDataRawSha256", "programDataPayloadSha256", "deployedArtifactSha256",
    "trailingBytesSha256", "compatibilityReceiptSha256", "compatibilityInventorySha256",
  ]) assertLowerHash(value.firstPost[field], `poststate repeat first post ${field}`);
  assert.equal(value.firstPost.bridgeUpgradeReceiptRawSha256, files.wrapper.sha256, "repeat bridge receipt raw hash changed");
  assert.equal(value.firstPost.bridgeUpgradeReceiptSha256, wrapper.receiptSha256, "repeat bridge semantic hash changed");
  assert.equal(value.firstPost.postSummaryRawSha256, files.summary.sha256, "repeat first summary raw hash changed");
  assert.equal(value.firstPost.postSummarySha256, summary.summarySha256, "repeat first summary semantic hash changed");
  assert.equal(value.firstPost.upgradeReceiptRawSha256, files.upgradeReceipt.sha256, "repeat first upgrade raw hash changed");
  assert.equal(value.firstPost.upgradeReceiptSha256, upgradeReceipt.receiptSha256, "repeat first upgrade semantic hash changed");
  assert.equal(value.firstPost.postProgramDataRawSha256, files.postRaw.sha256, "repeat first ProgramData raw hash changed");
  assert.equal(value.firstPost.transactionSignature, wrapper.transactionSignature, "repeat first transaction changed");
  assert.equal(value.firstPost.transactionSlot, wrapper.transactionSlot, "repeat first transaction slot changed");
  assert.equal(
    value.firstPost.finalizedContextSlot,
    summary.upgrade.finalizedContextSlot,
    "repeat first finalized context changed",
  );
  assert.equal(value.firstPost.programDataRawBytes, files.postRaw.bytes.length, "repeat first raw length changed");
  assert.equal(value.firstPost.programDataPayloadCapacityBytes, wrapper.postCapacityBytes, "repeat first capacity changed");
  assert.equal(value.firstPost.programDataPayloadSha256, wrapper.postProgramDataPayloadSha256, "repeat first payload changed");
  assert.equal(value.firstPost.deployedArtifactSha256, inputs.artifactSha256, "repeat first artifact changed");
  assert.equal(value.firstPost.deployedSlot, wrapper.postDeployedSlot, "repeat first deployed slot changed");
  assert.equal(value.firstPost.upgradeAuthority, LEGACY_AUTHORITY.toBase58(), "repeat first authority changed");
  assert.equal(value.firstPost.trailingBytes, wrapper.trailingBytes, "repeat first tail length changed");
  assert.equal(value.firstPost.trailingBytesSha256, wrapper.trailingBytesSha256, "repeat first tail hash changed");
  assert.equal(value.firstPost.trailingBytesAllZero, true, "repeat first tail is nonzero");
  assert.equal(value.firstPost.compatibilityReceiptSha256, summary.poststate.compatibilityReceiptSha256, "repeat first compatibility receipt changed");
  const firstInventory = validateCompatibilityInventory(value.firstPost.compatibilityInventory, "repeat first inventory");
  const firstInventorySha256 = sha256Hex(Buffer.from(compactCanonicalJson(firstInventory), "utf8"));
  assert.equal(value.firstPost.compatibilityInventorySha256, firstInventorySha256, "repeat first inventory semantic hash changed");
  assert.deepEqual(firstInventory, summary.poststate.compatibilityInventory, "repeat first inventory differs from authoritative first post");

  assertExactKeys(value.repeat, [
    "attempt", "censusRawSha256", "programDataRawSha256", "contextSlot",
    "compatibilityObservation", "compatibilityFullSha256", "compatibilityInventory",
    "compatibilityInventorySha256", "programExecutablePrefixSha256", "deployedSlot",
    "upgradeAuthority", "programDataRawBytes", "programDataPayloadCapacityBytes",
    "programDataPayloadSha256", "feePayer", "rentPayer", "deployedArtifactSha256",
    "trailingBytes", "trailingBytesSha256", "trailingBytesAllZero",
  ], "poststate repeat observation");
  assert.equal(value.repeat.attempt, Number(censusMatch[1]), "repeat attempt changed");
  for (const field of [
    "censusRawSha256", "programDataRawSha256", "compatibilityFullSha256",
    "compatibilityInventorySha256", "programExecutablePrefixSha256",
    "programDataPayloadSha256", "deployedArtifactSha256", "trailingBytesSha256",
  ]) assertLowerHash(value.repeat[field], `poststate repeat ${field}`);
  assert.equal(value.repeat.censusRawSha256, files.repeatCensus.sha256, "repeat census raw hash changed");
  assert.equal(value.repeat.programDataRawSha256, files.repeatRaw.sha256, "repeat ProgramData raw hash changed");
  for (const field of ["attempt", "contextSlot", "deployedSlot", "programDataRawBytes", "programDataPayloadCapacityBytes"]) {
    assertSafeInteger(value.repeat[field], `poststate repeat ${field}`, 1);
  }
  assertSafeInteger(value.repeat.trailingBytes, "poststate repeat trailing bytes");
  assertExactKeys(value.repeat.compatibilityObservation, [
    "captureStartSlot", "programInventoryVerifiedSlot", "contextSlot",
  ], "poststate repeat compatibility observation");
  for (const field of ["captureStartSlot", "programInventoryVerifiedSlot", "contextSlot"]) {
    assertSafeInteger(value.repeat.compatibilityObservation[field], `poststate repeat observation ${field}`, 1);
  }
  assert(value.repeat.compatibilityObservation.captureStartSlot > value.firstPost.finalizedContextSlot, "second census did not start after first poststate");
  assert(value.repeat.compatibilityObservation.captureStartSlot <= value.repeat.compatibilityObservation.contextSlot, "second census slots are reversed");
  assert(value.repeat.compatibilityObservation.programInventoryVerifiedSlot <= value.repeat.compatibilityObservation.contextSlot, "second census inventory verification follows its context");
  assert(value.repeat.contextSlot >= value.repeat.compatibilityObservation.contextSlot, "repeat ProgramData observation predates its census");
  const repeatInventory = validateCompatibilityInventory(value.repeat.compatibilityInventory, "repeat inventory");
  const repeatInventorySha256 = sha256Hex(Buffer.from(compactCanonicalJson(repeatInventory), "utf8"));
  assert.equal(value.repeat.compatibilityInventorySha256, repeatInventorySha256, "repeat inventory semantic hash changed");
  assert.deepEqual(repeatInventory, firstInventory, "second independent inventory differs from first poststate");
  assert.equal(value.repeat.programExecutablePrefixSha256, summary.prestate.programExecutablePrefixSha256, "repeat Program executable changed");
  assert.equal(value.repeat.deployedSlot, wrapper.postDeployedSlot, "repeat deployed slot changed");
  assert.equal(value.repeat.upgradeAuthority, LEGACY_AUTHORITY.toBase58(), "repeat authority changed");
  assert.equal(value.repeat.programDataRawBytes, files.repeatRaw.bytes.length, "repeat raw length changed");
  assert.equal(value.repeat.programDataPayloadCapacityBytes, wrapper.postCapacityBytes, "repeat capacity changed");
  assert.equal(value.repeat.programDataPayloadSha256, wrapper.postProgramDataPayloadSha256, "repeat payload changed");
  publicKey(value.repeat.feePayer, "poststate repeat fee payer");
  publicKey(value.repeat.rentPayer, "poststate repeat rent payer");
  assert.equal(value.repeat.deployedArtifactSha256, inputs.artifactSha256, "repeat deployed artifact changed");
  assert.equal(value.repeat.trailingBytes, wrapper.trailingBytes, "repeat tail length changed");
  assert.equal(value.repeat.trailingBytesSha256, wrapper.trailingBytesSha256, "repeat tail hash changed");
  assert.equal(value.repeat.trailingBytesAllZero, true, "repeat tail is nonzero");
  assert(files.repeatRaw.bytes.equals(files.postRaw.bytes), "second ProgramData snapshot differs byte-for-byte from first poststate");

  let census;
  try {
    census = JSON.parse(files.repeatCensus.bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`repeat census is not JSON: ${error.message}`);
  }
  assert(census !== null && typeof census === "object" && !Array.isArray(census), "repeat census must be an object");
  assert.equal(census.genesisHash, EXPECTED_GENESIS, "repeat census genesis changed");
  assert.equal(census.programId, TARGET.toBase58(), "repeat census Program changed");
  assert.equal(census.programDataAddress, TARGET_PROGRAMDATA.toBase58(), "repeat census ProgramData changed");
  assert.equal(census.programOwner, BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58(), "repeat census Program owner changed");
  assert.equal(census.programDataOwner, BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58(), "repeat census ProgramData owner changed");
  assert.equal(census.upgradeAuthority, LEGACY_AUTHORITY.toBase58(), "repeat census authority changed");
  assert.equal(census.contextSlot, value.repeat.contextSlot, "repeat census context changed");
  assert.equal(census.deployedSlot, value.repeat.deployedSlot, "repeat census deployed slot changed");
  assert.equal(census.programDataRawSha256, value.repeat.programDataRawSha256, "repeat census raw hash changed");
  assert.equal(census.programDataPayloadSha256, value.repeat.programDataPayloadSha256, "repeat census payload hash changed");
  assert.equal(census.programExecutablePrefixSha256, value.repeat.programExecutablePrefixSha256, "repeat census Program hash changed");
  assert(census.marketCompatibility !== null && typeof census.marketCompatibility === "object" && !Array.isArray(census.marketCompatibility), "repeat census compatibility evidence is malformed");
  assert.equal(
    sha256Hex(Buffer.from(compactPythonCanonicalTopLevelMember(
      files.repeatCensus.bytes,
      "marketCompatibility",
      "repeat census",
    ), "utf8")),
    value.repeat.compatibilityFullSha256,
    "repeat full compatibility commitment changed",
  );
  const censusInventory = Object.fromEntries(
    COMPATIBILITY_INVENTORY_KEYS.map((field) => [field, census.marketCompatibility[field]]),
  );
  validateCompatibilityInventory(censusInventory, "repeat census compatibility inventory");
  assert.deepEqual(censusInventory, repeatInventory, "repeat receipt inventory differs from the named census");

  assertExactKeys(value.historyExclusion, [
    "stateRpcProviderOriginSha256", "historyRpcProviderOriginSha256", "startExclusiveSlot",
    "throughInclusiveSlot", "lastValidTargetMutationSignature", "lastValidTargetMutationSlot",
    "successfulTargetMutationCountAfterBoundary", "failedTargetTransactionCountAfterBoundary",
    "observedEntryCount", "observedHistorySha256", "pageCount", "upgradeAnchorObserved",
    "boundaryReached", "verified",
  ], "poststate repeat history exclusion");
  for (const field of ["stateRpcProviderOriginSha256", "historyRpcProviderOriginSha256", "observedHistorySha256"]) {
    assertLowerHash(value.historyExclusion[field], `poststate repeat history ${field}`);
  }
  for (const field of [
    "startExclusiveSlot", "throughInclusiveSlot", "lastValidTargetMutationSlot",
    "successfulTargetMutationCountAfterBoundary", "failedTargetTransactionCountAfterBoundary",
    "observedEntryCount", "pageCount",
  ]) assertSafeInteger(value.historyExclusion[field], `poststate repeat history ${field}`);
  assert.equal(
    value.historyExclusion.startExclusiveSlot,
    summary.upgrade.finalizedContextSlot,
    "repeat history boundary changed",
  );
  assert(value.historyExclusion.throughInclusiveSlot >= value.repeat.contextSlot, "repeat history does not cover its census");
  assert.equal(value.historyExclusion.lastValidTargetMutationSignature, wrapper.transactionSignature, "repeat history anchor changed");
  assert.equal(value.historyExclusion.lastValidTargetMutationSlot, wrapper.transactionSlot, "repeat history anchor slot changed");
  assert.equal(value.historyExclusion.successfulTargetMutationCountAfterBoundary, 0, "target mutated after first poststate");
  assert(value.historyExclusion.pageCount >= 1 && value.historyExclusion.pageCount <= 100, "repeat history page count changed");
  assert.equal(value.historyExclusion.upgradeAnchorObserved, true, "repeat history missed the upgrade anchor");
  assert.equal(value.historyExclusion.boundaryReached, true, "repeat history missed its boundary");
  assert.equal(value.historyExclusion.verified, true, "repeat history is unverified");

  assertExactKeys(value.comparison, [
    "exactProgramDataBytesEqual", "exactProgramExecutableEqual", "exactInventoryRootsAndCountsEqual",
    "secondCaptureStartsAfterFirstPost", "firstInventorySha256", "repeatInventorySha256",
    "step8SecondIndependentCensusSatisfied",
  ], "poststate repeat comparison");
  assert.equal(value.comparison.firstInventorySha256, firstInventorySha256, "repeat comparison first inventory changed");
  assert.equal(value.comparison.repeatInventorySha256, repeatInventorySha256, "repeat comparison second inventory changed");
  for (const field of [
    "exactProgramDataBytesEqual", "exactProgramExecutableEqual", "exactInventoryRootsAndCountsEqual",
    "secondCaptureStartsAfterFirstPost", "step8SecondIndependentCensusSatisfied",
  ]) assert.equal(value.comparison[field], true, `poststate repeat comparison ${field} failed`);
  assertSemanticHash(value, POSTSTATE_REPEAT_RECEIPT_DOMAIN, "receiptSha256", "poststate repeat receipt");
  return { firstInventorySha256, repeatInventorySha256 };
}

async function readBridgeEvidence(bridgeRunDir, inputs) {
  const wrapper = await readRunFile(bridgeRunDir, BRIDGE_UPGRADE_RECEIPT_FILE, "reviewed bridge upgrade receipt");
  wrapper.value = parseCanonicalJson(wrapper.bytes, "reviewed bridge upgrade receipt", { sorted: false });
  validateBridgeUpgradeReceipt(wrapper.value, wrapper.bytes, inputs);

  const summaryMatch = assertCanonicalBasename(wrapper.value.authoritativePostSummaryFile, FIRST_POST_FILE_PATTERN, "authoritative first-post summary filename");
  const upgradeMatch = assertCanonicalBasename(wrapper.value.authoritativeUpgradeReceiptFile, FIRST_POST_FILE_PATTERN, "authoritative first-post upgrade receipt filename");
  const rawMatch = assertCanonicalBasename(wrapper.value.authoritativePostProgramDataRawFile, FIRST_POST_FILE_PATTERN, "authoritative first-post ProgramData filename");
  assert.equal(summaryMatch[2], "summary.json", "authoritative first-post summary suffix changed");
  assert.equal(upgradeMatch[2], "upgrade-receipt.json", "authoritative first-post upgrade suffix changed");
  assert.equal(rawMatch[2], "programdata.raw", "authoritative first-post ProgramData suffix changed");
  assert.equal(summaryMatch[1], upgradeMatch[1], "authoritative first-post attempts differ");
  assert.equal(summaryMatch[1], rawMatch[1], "authoritative first-post attempts differ");

  const summary = await readRunFile(bridgeRunDir, wrapper.value.authoritativePostSummaryFile, "authoritative first-post summary");
  const upgradeReceipt = await readRunFile(bridgeRunDir, wrapper.value.authoritativeUpgradeReceiptFile, "authoritative first-post upgrade receipt");
  const postRaw = await readRunFile(bridgeRunDir, wrapper.value.authoritativePostProgramDataRawFile, "authoritative first-post ProgramData");
  assert.equal(summary.sha256, wrapper.value.postCompatibilitySummaryRawSha256, "authoritative first-post summary raw hash changed");
  assert.equal(upgradeReceipt.sha256, wrapper.value.authoritativeUpgradeReceiptRawSha256, "authoritative first-post upgrade raw hash changed");
  assert.equal(postRaw.sha256, wrapper.value.authoritativePostProgramDataRawSha256, "authoritative first-post ProgramData raw hash changed");
  summary.value = parseCanonicalJson(summary.bytes, "authoritative first-post summary");
  upgradeReceipt.value = parseCanonicalJson(upgradeReceipt.bytes, "authoritative first-post upgrade receipt");
  validateFirstPostSummary(summary.value, summary.bytes, wrapper.value, inputs, postRaw.bytes);
  validateAuthoritativeUpgradeReceipt(upgradeReceipt.value, wrapper.value, summary.value, inputs);

  const repeatReceipt = await readRunFile(bridgeRunDir, POSTSTATE_REPEAT_RECEIPT_FILE, "poststate repeat receipt");
  repeatReceipt.value = parseCanonicalJson(repeatReceipt.bytes, "poststate repeat receipt");
  assertExactKeys(repeatReceipt.value, POSTSTATE_REPEAT_RECEIPT_KEYS, "poststate repeat receipt");
  const repeatCensusName = repeatReceipt.value.evidenceFiles?.repeatCensus;
  const repeatRawName = repeatReceipt.value.evidenceFiles?.repeatProgramDataRaw;
  assertCanonicalBasename(repeatCensusName, POSTSTATE_REPEAT_CENSUS_PATTERN, "poststate repeat census filename");
  assertCanonicalBasename(repeatRawName, POSTSTATE_REPEAT_RAW_PATTERN, "poststate repeat ProgramData filename");
  const repeatCensus = await readRunFile(bridgeRunDir, repeatCensusName, "poststate repeat census");
  const repeatRaw = await readRunFile(bridgeRunDir, repeatRawName, "poststate repeat ProgramData");
  const files = { wrapper, summary, upgradeReceipt, postRaw, repeatReceipt, repeatCensus, repeatRaw };
  const inventories = validateRepeatReceipt(
    repeatReceipt.value,
    wrapper.value,
    summary.value,
    upgradeReceipt.value,
    inputs,
    files,
  );
  return {
    ...files,
    inventories,
    firstPostAttempt: Number(summaryMatch[1]),
    proofBuffer: publicKey(wrapper.value.formerAuthorityProofBuffer, "reviewed former-authority proof buffer"),
  };
}

function assertReleaseEvidenceLineage(inputs, bridge) {
  const { source, buildInputs, packageReceipt, releaseManifest, manifest, buildReceipt, buildInventory } = inputs.evidence;
  assert(packageReceipt.bytes.equals(bridge.repeatReceipt.bytes), "package evidence is not byte-identical to the authoritative repeat census receipt");
  assert.equal(packageReceipt.sha256, bridge.repeatReceipt.sha256, "package evidence raw SHA-256 changed");
  assert.equal(source.sha256, bridge.summary.value.buildReceiptRawSha256, "first poststate summary does not bind the supplied ceremony build receipt");
  assert.equal(source.sha256, bridge.repeatReceipt.value.build.receiptRawSha256, "repeat census does not bind the supplied ceremony build receipt");
  assert.equal(buildInputs.sha256, bridge.repeatReceipt.value.build.inputInventoryRawSha256, "repeat census does not bind the supplied build inventory");
  assert.equal(
    buildInventory.value.summary.aggregateSha256,
    bridge.repeatReceipt.value.build.inputInventoryAggregateSha256,
    "repeat census build-input aggregate changed",
  );
  assert.equal(buildReceipt.prebuildPlan.sha256, bridge.repeatReceipt.value.build.prebuildPlanRawSha256, "repeat census pre-build plan lineage changed");
  assert.equal(buildReceipt.source.commit, bridge.repeatReceipt.value.build.sourceCommit, "repeat census source commit changed");
  assert.equal(buildReceipt.source.tree, bridge.repeatReceipt.value.build.sourceTree, "repeat census source tree changed");
  assert.equal(buildReceipt.artifact.sha256, bridge.repeatReceipt.value.artifact.sha256, "repeat census artifact hash differs from the ceremony build");
  assert.equal(buildReceipt.artifact.sizeBytes, bridge.repeatReceipt.value.artifact.sizeBytes, "repeat census artifact size differs from the ceremony build");
  assert.equal(manifest.sourceEvidenceSha256, source.sha256, "release manifest source lineage changed");
  assert.equal(manifest.buildInputsEvidenceSha256, buildInputs.sha256, "release manifest build-input lineage changed");
  assert.equal(manifest.packageEvidenceSha256, packageReceipt.sha256, "release manifest package lineage changed");
  assert.equal(manifest.artifactSha256, buildReceipt.artifact.sha256, "release manifest artifact differs from the ceremony build");
  assert.equal(manifest.artifactBytes, buildReceipt.artifact.sizeBytes, "release manifest artifact size differs from the ceremony build");
  assertLowerHash(releaseManifest.sha256, "release manifest raw SHA-256");
}

async function readActivationInputs() {
  const inputs = await readInputs();
  const { bridgeRunDir } = inputs;
  const proofReceiptFile = await requireSecureRegularFile(
    fileInRunDir(bridgeRunDir, PROOF_BUFFER_RECEIPT_FILE),
    "former-authority proof-buffer receipt",
  );
  const proofReceiptBytes = await readFile(proofReceiptFile);
  const proofReceipt = JSON.parse(proofReceiptBytes.toString("utf8"));
  assertExactKeys(proofReceipt, PROOF_BUFFER_RECEIPT_KEYS, "former-authority proof-buffer receipt");
  assert.equal(proofReceipt.schema, "ameba-spread-former-authority-proof-buffer-receipt-v1");
  assert.equal(proofReceipt.mainnetAllowed, false);
  assert.equal(proofReceipt.genesisHash, EXPECTED_GENESIS);
  assert.equal(proofReceipt.targetProgram, TARGET.toBase58());
  assert.equal(proofReceipt.targetProgramData, TARGET_PROGRAMDATA.toBase58());
  assert.equal(proofReceipt.loader, BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58());
  const proofBuffer = publicKey(proofReceipt.proofBuffer, "former-authority proof buffer");
  assert.equal(requiredEnvironment("AMEBA_SPREAD_BRIDGE_PROOF_BUFFER_ADDRESS"), proofBuffer.toBase58(), "proof-buffer environment identity changed");
  assert.equal(proofReceipt.proofBuffer, inputs.bridgeEvidence.wrapper.value.formerAuthorityProofBuffer, "proof-buffer identity differs from the authoritative bridge receipt");
  assert.equal(proofReceipt.bufferAuthority, LEGACY_AUTHORITY.toBase58());
  assert.equal(proofReceipt.spillTreasury, TREASURY.toBase58());
  assert.equal(proofReceipt.artifactBytes, inputs.artifact.length);
  assert.equal(proofReceipt.artifactSha256, inputs.artifactSha256);
  assert.equal(proofReceipt.artifactMerkleRoot, inputs.artifactMerkle.toString("hex"));
  assert.equal(proofReceipt.artifactChunkSize, RELEASE1_ARTIFACT_CHUNK_SIZE_V1);
  assert.equal(proofReceipt.artifactChunkCount, artifactChunkCount(inputs.artifact.length, RELEASE1_ARTIFACT_CHUNK_SIZE_V1));
  assert.equal(proofReceipt.bufferPayloadOffset, BUFFER_HEADER_LEN);
  assert.equal(proofReceipt.bufferRawBytes, BUFFER_HEADER_LEN + inputs.artifact.length);
  assertLowerHash(proofReceipt.bufferRawSha256, "proof-buffer raw SHA-256");
  assert.equal(proofReceipt.bufferRawSha256, inputs.bridgeEvidence.wrapper.value.formerAuthorityProofBufferRawSha256, "proof-buffer raw hash differs from the authoritative bridge receipt");
  assert(Number.isSafeInteger(proofReceipt.finalizedSlot) && proofReceipt.finalizedSlot > 0, "proof-buffer finalized slot is invalid");
  assertLowerHash(proofReceipt.sourceDeploymentPlanSha256, "proof-buffer deployment-plan SHA-256");
  assertLowerHash(proofReceipt.sourceDeploymentReceiptSha256, "proof-buffer bridge-upgrade receipt SHA-256");
  const bridgeDeploymentPlanFile = await requireSecureRegularFile(
    fileInRunDir(bridgeRunDir, BRIDGE_DEPLOYMENT_PLAN_FILE),
    "Spread bridge deployment plan",
  );
  const bridgeUpgradeReceiptFile = inputs.bridgeEvidence.wrapper.file;
  assert.equal(sha256Hex(await readFile(bridgeDeploymentPlanFile)), proofReceipt.sourceDeploymentPlanSha256, "proof-buffer source deployment plan changed");
  assert.equal(inputs.bridgeEvidence.wrapper.sha256, proofReceipt.sourceDeploymentReceiptSha256, "proof-buffer source deployment receipt changed");
  const handoffReceiptFile = await requireSecureRegularFile(
    fileInRunDir(inputs.runDir, RECEIPT_FILE),
    "Spread handoff receipt",
  );
  const handoffReceiptBytes = await readFile(handoffReceiptFile);
  const handoffLocalReceipt = JSON.parse(handoffReceiptBytes.toString("utf8"));
  assertExactKeys(handoffLocalReceipt, HANDOFF_RECEIPT_KEYS, "Spread handoff receipt");
  assert.equal(handoffLocalReceipt.schema, RECEIPT_SCHEMA);
  assert.equal(handoffLocalReceipt.mainnetAllowed, false);
  assert.equal(handoffLocalReceipt.genesisHash, EXPECTED_GENESIS);
  assert.equal(handoffLocalReceipt.controllerProgram, CONTROLLER.toBase58());
  assert.equal(handoffLocalReceipt.targetProgram, TARGET.toBase58());
  assert.equal(handoffLocalReceipt.targetProgramdata, TARGET_PROGRAMDATA.toBase58());
  assert.equal(handoffLocalReceipt.legacyAuthority, LEGACY_AUTHORITY.toBase58());
  assert.equal(handoffLocalReceipt.artifactSha256, inputs.artifactSha256);
  assert.equal(handoffLocalReceipt.artifactMerkleRoot, inputs.artifactMerkle.toString("hex"));
  const augmented = {
    ...inputs,
    bridgeRunDir,
    proofReceipt,
    proofReceiptFile,
    proofReceiptSha256: sha256Hex(proofReceiptBytes),
    proofBuffer,
    bridgeDeploymentPlanFile,
    bridgeUpgradeReceiptFile,
    handoffLocalReceipt,
    handoffLocalReceiptFile,
    handoffLocalReceiptSha256: sha256Hex(handoffReceiptBytes),
  };
  const postHandoffAuthorityDelta = await readAuthorityDeltaEvidence(
    augmented,
    "post-handoff",
    "AMEBA_SPREAD_POST_HANDOFF_AUTHORITY_DELTA_RECEIPT",
  );
  const postActivationAuthorityDelta = await readAuthorityDeltaEvidence(
    augmented,
    "post-activation",
    "AMEBA_SPREAD_POST_ACTIVATION_AUTHORITY_DELTA_RECEIPT",
    postHandoffAuthorityDelta,
    { optional: true },
  );
  return { ...augmented, postHandoffAuthorityDelta, postActivationAuthorityDelta };
}

function parseBufferAccount(account, inputs, label = "former-authority proof buffer") {
  const raw = assertAccount(
    account,
    BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    BUFFER_HEADER_LEN + inputs.artifact.length,
    label,
  ).data;
  assert.equal(raw.readUInt32LE(0), 1, `${label} is not a Loader-v3 Buffer`);
  assert.equal(raw[4], 1, `${label} authority is absent`);
  const authority = new PublicKey(raw.subarray(5, BUFFER_HEADER_LEN));
  assert(authority.equals(LEGACY_AUTHORITY), `${label} authority changed`);
  assert(raw.subarray(BUFFER_HEADER_LEN).equals(inputs.artifact), `${label} payload is not the exact reviewed bridge artifact`);
  const expectedRawSha256 = inputs.proofReceipt?.bufferRawSha256
    ?? inputs.bridgeEvidence.wrapper.value.formerAuthorityProofBufferRawSha256;
  assert.equal(sha256Hex(raw), expectedRawSha256, `${label} raw SHA-256 changed`);
  return { raw: Buffer.from(raw), authority, payload: Buffer.from(raw.subarray(BUFFER_HEADER_LEN)) };
}

function directFormerAuthorityUpgradeInstruction(buffer) {
  return new TransactionInstruction({
    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    keys: [
      { pubkey: TARGET_PROGRAMDATA, isSigner: false, isWritable: true },
      { pubkey: TARGET, isSigner: false, isWritable: true },
      { pubkey: buffer, isSigner: false, isWritable: true },
      { pubkey: TREASURY, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: LEGACY_AUTHORITY, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(LOADER_UPGRADE_DATA),
  });
}

function directFormerAuthorityCloseBufferInstruction(buffer) {
  return new TransactionInstruction({
    programId: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    keys: [
      { pubkey: buffer, isSigner: false, isWritable: true },
      { pubkey: TREASURY, isSigner: false, isWritable: true },
      { pubkey: LEGACY_AUTHORITY, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(LOADER_CLOSE_DATA),
  });
}

function proofBufferCloseReceiptSha256(receipt) {
  const material = Object.fromEntries(
    PROOF_BUFFER_CLOSE_RECEIPT_KEYS
      .filter((key) => key !== "receiptSha256")
      .map((key) => [key, receipt[key]]),
  );
  return hashBytes(
    Buffer.from(PROOF_BUFFER_CLOSE_RECEIPT_DOMAIN, "ascii"),
    Buffer.from([0]),
    Buffer.from(JSON.stringify(material), "utf8"),
  ).toString("hex");
}

function harmlessGovernedSpreadProbe(epoch, gate) {
  assert(epoch > 0n && epoch <= 0xffff_ffff_ffff_ffffn, "Spread probe epoch is outside u64");
  const tail = Buffer.alloc(16);
  Buffer.from("AGV1", "ascii").copy(tail, 0);
  tail[4] = 1;
  tail.writeBigUInt64LE(epoch, 8);
  return new TransactionInstruction({
    programId: TARGET,
    keys: [{ pubkey: gate, isSigner: false, isWritable: false }],
    data: Buffer.concat([Buffer.from([2, 0, 0, 0, 0, 0]), tail]),
  });
}

function governanceTail(epoch) {
  assert(epoch > 0n && epoch <= 0xffff_ffff_ffff_ffffn, "governance epoch is outside u64");
  const tail = Buffer.alloc(16);
  Buffer.from("AGV1", "ascii").copy(tail, 0);
  tail[4] = 1;
  tail.writeBigUInt64LE(epoch, 8);
  return tail;
}

function frozenGateProbeInstruction(manifestEntry, epoch, gate) {
  const mutating = manifestEntry.default_class === "RecognizedMutating";
  const data = mutating
    ? Buffer.concat([Buffer.from([manifestEntry.byte]), governanceTail(epoch)])
    : Buffer.from([manifestEntry.byte]);
  return new TransactionInstruction({
    programId: TARGET,
    keys: mutating
      ? [{ pubkey: gate, isSigner: false, isWritable: false }]
      // The foreign executable account is deliberate poison. Unknown/reserved tags must reject
      // generically before attempting to interpret the absolute-final account as a gate.
      : [{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false }],
    data,
  });
}

function frozenGateCensusReceiptSha256(receipt) {
  const unsigned = { ...receipt };
  delete unsigned.receiptSha256;
  return hashBytes(
    Buffer.from(FROZEN_GATE_CENSUS_DOMAIN, "ascii"),
    Buffer.from([0]),
    Buffer.from(compactCanonicalJson(unsigned), "utf8"),
  ).toString("hex");
}

function assertCustomInstructionError(error, code, label) {
  assert(error && typeof error === "object", `${label} did not fail`);
  const instructionError = error.InstructionError;
  assert(Array.isArray(instructionError) && instructionError.length === 2, `${label} error is not an InstructionError`);
  assert.equal(instructionError[0], 0, `${label} failed in the wrong instruction`);
  assert.deepEqual(instructionError[1], { Custom: code }, `${label} failed with the wrong custom error`);
}

function assertIncorrectAuthorityFailure(error, logs, label) {
  assert(error && typeof error === "object", `${label} unexpectedly succeeded`);
  const instructionError = error.InstructionError;
  assert(Array.isArray(instructionError) && instructionError.length === 2, `${label} error is not an InstructionError`);
  assert.equal(instructionError[0], 0, `${label} failed in the wrong instruction`);
  assert.equal(instructionError[1], "IncorrectAuthority", `${label} did not fail with IncorrectAuthority`);
  assert(Array.isArray(logs) && logs.some((entry) => entry.includes("Incorrect authority provided")), `${label} logs do not prove the authority mismatch`);
}

async function loadFrozenGateCensus(runDir, inputs, { optional = false } = {}) {
  const file = fileInRunDir(runDir, FROZEN_GATE_CENSUS_FILE);
  let bytes;
  try {
    bytes = await readFile(file);
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    throw error;
  }
  await requireSecureRegularFile(file, "frozen-gate instruction census");
  const receipt = JSON.parse(bytes.toString("utf8"));
  assertExactKeys(receipt, FROZEN_GATE_CENSUS_KEYS, "frozen-gate instruction census");
  assert.equal(receipt.schema, FROZEN_GATE_CENSUS_SCHEMA, "frozen-gate census schema changed");
  assert.equal(receipt.mainnetAllowed, false, "frozen-gate census allows Mainnet");
  assert.equal(receipt.genesisHash, EXPECTED_GENESIS, "frozen-gate census genesis changed");
  assert.equal(receipt.targetProgram, TARGET.toBase58(), "frozen-gate census target changed");
  const [expectedGate] = deriveGatePda(CONTROLLER, TARGET);
  assert.equal(receipt.protocolGate, expectedGate.toBase58(), "frozen-gate census gate changed");
  assert.equal(receipt.gateStatus, GateStatusV1.EmergencyFrozen, "frozen-gate census was not captured while bootstrap-frozen");
  assert(/^[1-9][0-9]*$/u.test(receipt.gateEpoch), "frozen-gate census epoch is invalid");
  assert.equal(receipt.manifestFile, PHASE3_INSTRUCTION_MANIFEST_FILE, "frozen-gate census manifest basename changed");
  assert.equal(receipt.manifestRawSha256, inputs.evidence.phase3ManifestEvidence.sha256, "frozen-gate census manifest bytes changed");
  assert.equal(receipt.buildInventoryRawSha256, inputs.evidence.buildInputs.sha256, "frozen-gate census build inventory changed");
  assertSafeInteger(receipt.observedSlotBefore, "frozen-gate census starting slot", 1);
  assertSafeInteger(receipt.observedSlotAfter, "frozen-gate census ending slot", receipt.observedSlotBefore);
  for (const field of [
    "programdataRawSha256Before", "programdataRawSha256After", "gateAccountSha256Before",
    "gateAccountSha256After", "toolSha256", "receiptSha256",
  ]) assertLowerHash(receipt[field], `frozen-gate census ${field}`);
  assert.equal(receipt.programdataRawSha256After, receipt.programdataRawSha256Before, "frozen-gate census changed ProgramData");
  assert.equal(receipt.gateAccountSha256After, receipt.gateAccountSha256Before, "frozen-gate census changed the gate");
  assert.equal(receipt.assignedMutatorCount, 129, "frozen-gate census assigned-mutator count changed");
  assert.equal(receipt.unknownCount, 124, "frozen-gate census unknown-tag count changed");
  assert.equal(receipt.reservedCount, 3, "frozen-gate census reserved-tag count changed");
  assert(Array.isArray(receipt.results) && receipt.results.length === 256, "frozen-gate census is not exhaustive");
  receipt.results.forEach((result, byte) => {
    assertExactKeys(result, ["byte", "name", "class", "expectedCustomError", "simulationError", "logsSha256", "unitsConsumed"], `frozen-gate census result ${byte}`);
    assert.equal(result.byte, byte, `frozen-gate census result ${byte} is missing or reordered`);
    const manifestEntry = inputs.evidence.phase3Manifest.value.tags[byte];
    assert.equal(result.name, manifestEntry.name, `frozen-gate census tag ${byte} name changed`);
    assert.equal(result.class, manifestEntry.default_class, `frozen-gate census tag ${byte} class changed`);
    const expected = result.class === "RecognizedMutating" ? GOVERNANCE_GATE_FROZEN_ERROR : GENERIC_INVALID_INSTRUCTION_ERROR;
    assert.equal(result.expectedCustomError, expected, `frozen-gate census tag ${byte} expected error changed`);
    assertCustomInstructionError(result.simulationError, expected, `frozen-gate census tag ${byte}`);
    assertLowerHash(result.logsSha256, `frozen-gate census tag ${byte} log hash`);
    assert(result.unitsConsumed === null || (Number.isSafeInteger(result.unitsConsumed) && result.unitsConsumed >= 0), `frozen-gate census tag ${byte} units are invalid`);
  });
  assert.equal(receipt.stateMutationObserved, false, "frozen-gate census recorded state mutation");
  assert.equal(receipt.toolSha256, sha256Hex(await readFile(fileURLToPath(import.meta.url))), "frozen-gate census tool changed");
  assert.equal(receipt.receiptSha256, frozenGateCensusReceiptSha256(receipt), "frozen-gate census semantic hash changed");
  return { receipt, file, bytes, sha256: sha256Hex(bytes) };
}

async function ensureFrozenGateCensus(connection, journal, inputs, state) {
  const existing = inputs.frozenGateCensus ?? await loadFrozenGateCensus(inputs.runDir, inputs, { optional: true });
  if (existing) {
    assert.equal(existing.receipt.gateEpoch, state.gate.epoch.toString(), "existing frozen-gate census epoch differs from current state");
    assert.equal(existing.receipt.programdataRawSha256After, sha256Hex(state.targetProgramdata.raw), "existing frozen-gate census ProgramData is stale");
    assert.equal(existing.receipt.gateAccountSha256After, state.baseFingerprints.protocolGate.dataSha256, "existing frozen-gate census gate is stale");
    assert(state.slot >= existing.receipt.observedSlotAfter, "current state predates the frozen-gate census");
    return existing;
  }
  assert.equal(state.gate.status, GateStatusV1.EmergencyFrozen, "frozen-gate census requires the bootstrap-frozen gate");
  const results = [];
  await journal.append("frozen-gate-census-started", {
    observedSlot: state.slot,
    gateEpoch: state.gate.epoch.toString(),
    manifestRawSha256: inputs.evidence.phase3ManifestEvidence.sha256,
    instructionCount: 256,
    submissionAllowed: false,
  });
  for (const entry of inputs.evidence.phase3Manifest.value.tags) {
    const instruction = frozenGateProbeInstruction(entry, state.gate.epoch, state.ids.gate);
    const message = new TransactionMessage({
      payerKey: PAYER,
      recentBlockhash: EXPECTED_GENESIS,
      instructions: [instruction],
    }).compileToV0Message();
    const transaction = new VersionedTransaction(message);
    const simulation = await connection.simulateTransaction(transaction, {
      commitment: "processed",
      sigVerify: false,
      replaceRecentBlockhash: true,
      minContextSlot: state.slot,
    });
    const expected = entry.default_class === "RecognizedMutating"
      ? GOVERNANCE_GATE_FROZEN_ERROR
      : GENERIC_INVALID_INSTRUCTION_ERROR;
    assertCustomInstructionError(simulation.value.err, expected, `frozen-gate census tag ${entry.byte}`);
    results.push({
      byte: entry.byte,
      name: entry.name,
      class: entry.default_class,
      expectedCustomError: expected,
      simulationError: simulation.value.err,
      logsSha256: sha256Hex(Buffer.from(JSON.stringify(simulation.value.logs ?? []), "utf8")),
      unitsConsumed: simulation.value.unitsConsumed ?? null,
    });
  }
  const after = await readBaseState(connection, inputs, state.slot, GateStatusV1.EmergencyFrozen);
  assert.equal(sha256Hex(after.targetProgramdata.raw), sha256Hex(state.targetProgramdata.raw), "frozen-gate simulations changed ProgramData");
  assert.equal(after.baseFingerprints.protocolGate.dataSha256, state.baseFingerprints.protocolGate.dataSha256, "frozen-gate simulations changed the gate");
  const receipt = {
    schema: FROZEN_GATE_CENSUS_SCHEMA,
    mainnetAllowed: false,
    genesisHash: EXPECTED_GENESIS,
    targetProgram: TARGET.toBase58(),
    protocolGate: state.ids.gate.toBase58(),
    gateStatus: state.gate.status,
    gateEpoch: state.gate.epoch.toString(),
    manifestFile: PHASE3_INSTRUCTION_MANIFEST_FILE,
    manifestRawSha256: inputs.evidence.phase3ManifestEvidence.sha256,
    buildInventoryRawSha256: inputs.evidence.buildInputs.sha256,
    observedSlotBefore: state.slot,
    observedSlotAfter: after.slot,
    programdataRawSha256Before: sha256Hex(state.targetProgramdata.raw),
    programdataRawSha256After: sha256Hex(after.targetProgramdata.raw),
    gateAccountSha256Before: state.baseFingerprints.protocolGate.dataSha256,
    gateAccountSha256After: after.baseFingerprints.protocolGate.dataSha256,
    assignedMutatorCount: 129,
    unknownCount: 124,
    reservedCount: 3,
    results,
    stateMutationObserved: false,
    toolSha256: sha256Hex(await readFile(fileURLToPath(import.meta.url))),
    receiptSha256: "",
  };
  receipt.receiptSha256 = frozenGateCensusReceiptSha256(receipt);
  await writeJsonOnce(fileInRunDir(inputs.runDir, FROZEN_GATE_CENSUS_FILE), receipt);
  const loaded = await loadFrozenGateCensus(inputs.runDir, inputs);
  await journal.append("frozen-gate-census-complete", {
    receiptRawSha256: loaded.sha256,
    receiptSha256: loaded.receipt.receiptSha256,
    observedSlotAfter: loaded.receipt.observedSlotAfter,
    assignedMutatorCount: loaded.receipt.assignedMutatorCount,
    unknownCount: loaded.receipt.unknownCount,
    reservedCount: loaded.receipt.reservedCount,
  });
  return loaded;
}

function derivedIdentities(councilVersion = 1n) {
  const [config, configBump] = deriveControllerConfigPda(CONTROLLER, TARGET);
  const [authority, authorityBump] = deriveAuthorityPda(CONTROLLER, TARGET);
  const [gate, gateBump] = deriveGatePda(CONTROLLER, TARGET);
  const [policy, policyBump] = derivePolicyPda(CONTROLLER, TARGET, 1n);
  const [council, councilBump] = deriveCouncilPda(CONTROLLER, TARGET, councilVersion);
  const [capacityPolicy, capacityBump] = deriveCapacityPolicyPdaV1(CONTROLLER, TARGET);
  const [immutabilityReceipt, immutabilityBump] = deriveControllerImmutabilityReceiptPdaV1(CONTROLLER, TARGET);
  const [handoffProposal, handoffProposalBump] = deriveTargetAuthorityHandoffProposalPdaV1(CONTROLLER, TARGET, councilVersion);
  const [handoffReceipt, handoffReceiptBump] = deriveTargetAuthorityHandoffReceiptPdaV1(CONTROLLER, TARGET);
  const [activationProposal, activationProposalBump] = deriveBootstrapActivationProposalPdaV1(CONTROLLER, TARGET, councilVersion);
  const [activationReceipt, activationReceiptBump] = deriveBootstrapActivationReceiptPdaV1(CONTROLLER, TARGET);
  const [currentDeployment, currentDeploymentBump] = deriveCurrentDeploymentStatePdaV1(CONTROLLER, TARGET);
  return {
    config, configBump, authority, authorityBump, gate, gateBump, policy, policyBump,
    council, councilBump, capacityPolicy, capacityBump, immutabilityReceipt,
    immutabilityBump, handoffProposal, handoffProposalBump, handoffReceipt,
    handoffReceiptBump, activationProposal, activationProposalBump,
    activationReceipt, activationReceiptBump, currentDeployment,
    currentDeploymentBump,
  };
}

function finalizedConfig(minContextSlot = 0) {
  return {
    commitment: "finalized",
    ...(minContextSlot > 0 ? { minContextSlot } : {}),
  };
}

function assertIdentityConfig(config, ids) {
  assert(config.targetProgram.equals(TARGET), "controller target Program changed");
  assert(config.targetProgramdata.equals(TARGET_PROGRAMDATA), "controller target ProgramData changed");
  assert(config.upgradeableLoader.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), "controller Loader changed");
  assert(config.authorityPda.equals(ids.authority), "controller authority PDA changed");
  assert(config.gatePda.equals(ids.gate), "controller gate PDA changed");
  assert.equal(config.currentPolicyVersion, 1n, "controller current policy version changed");
  assert.equal(config.currentCouncilVersion, 1n, "controller current council version changed");
  assert(config.targetNonce > 0n, "controller target nonce is zero");
  assert.equal(config.tokenGovernanceEnabled, false, "token governance became enabled");
  for (const [field, key] of Object.entries({
    voteProgram: config.voteProgram,
    voteProgramdata: config.voteProgramdata,
    voteConfig: config.voteConfig,
    voteMint: config.voteMint,
  })) assert(key.equals(PublicKey.default), `${field} is nondefault`);
}

function assertPolicyAndCouncil(policy, council, config, ids, slot) {
  assert(policy.controllerConfig.equals(ids.config), "policy config changed");
  assert(policy.targetProgram.equals(TARGET), "policy target changed");
  assert.equal(policy.version, config.currentPolicyVersion, "policy version changed");
  assert.equal(policy.councilSize, 5, "policy council size changed");
  assert.equal(policy.routineThreshold, 3, "policy routine threshold changed");
  assert.equal(policy.terminalThreshold, 4, "policy terminal threshold changed");
  assert.equal(policy.governanceMode, 0, "policy governance mode changed");
  assert.equal(policy.policyFlags, 0, "policy flags changed");
  assert(policy.policyHash.equals(governancePolicyHash(policy)), "policy hash changed");
  assert(council.controllerConfig.equals(ids.config), "council config changed");
  assert(council.targetProgram.equals(TARGET), "council target changed");
  assert.equal(council.version, config.currentCouncilVersion, "council version changed");
  assert.equal(council.routineThreshold, 3, "council routine threshold changed");
  assert.equal(council.terminalThreshold, 4, "council terminal threshold changed");
  assert.equal(council.policyFlags, 0, "council flags changed");
  assert(council.setHash.equals(governanceCouncilSetHash(council)), "council hash changed");
  assert.equal(council.seats.length, 5, "council seat count changed");
  council.seats.forEach((seat, index) => {
    assert(seat.seatAuthority.equals(SEATS[index]), `council seat ${index} authority changed`);
    assert.equal(seat.active, true, `council seat ${index} became inactive`);
    assert(seat.termStartSlot <= BigInt(slot) && BigInt(slot) < seat.termEndSlot, `council seat ${index} term does not cover the finalized slot`);
  });
}

function approvalSeatRunway(state, cycleCount, observationTransactionCount, label) {
  assert(Number.isSafeInteger(cycleCount) && cycleCount >= 1 && cycleCount <= 2, `${label} cycle count is invalid`);
  assert(Number.isSafeInteger(observationTransactionCount) && observationTransactionCount >= 1, `${label} observation count is invalid`);
  const reviewSlots = state.config.voteReviewSlots;
  const majorDelaySlots = state.config.majorDelaySlots;
  assert(reviewSlots > 0n && majorDelaySlots > 0n, `${label} timing policy is invalid`);
  const requiredTermEndSlot = BigInt(state.slot)
    + (BigInt(cycleCount) * (reviewSlots + majorDelaySlots))
    + CEREMONY_TRANSITION_SLOT_ALLOWANCE
    + BigInt(observationTransactionCount)
    + CEREMONY_SEAT_TERM_SAFETY_SLOTS;
  const approvalSeatTermEndSlots = state.council.seats.slice(0, 3).map((seat, index) => {
    assert.equal(seat.active, true, `${label} approval seat ${index} is inactive`);
    assert(seat.termStartSlot <= BigInt(state.slot), `${label} approval seat ${index} has not started`);
    assert(seat.termEndSlot > requiredTermEndSlot, `${label} approval seat ${index} does not cover every remaining review/timelock cycle plus safety margin`);
    return seat.termEndSlot.toString();
  });
  return {
    cycleCount,
    reviewSlotsPerCycle: reviewSlots.toString(),
    majorDelaySlotsPerCycle: majorDelaySlots.toString(),
    observationTransactionAllowance: observationTransactionCount,
    transitionSlotAllowance: CEREMONY_TRANSITION_SLOT_ALLOWANCE.toString(),
    safetyMarginSlots: CEREMONY_SEAT_TERM_SAFETY_SLOTS.toString(),
    requiredTermEndSlot: requiredTermEndSlot.toString(),
    approvalSeatTermEndSlots,
  };
}

function assertApprovalSeatRunway(plan, state, label) {
  const runway = plan.governance.approvalSeatRunway;
  assert(runway && typeof runway === "object", `${label} approval-seat runway is absent`);
  assert([1, 2].includes(runway.cycleCount), `${label} approval-seat cycle count changed`);
  assert.equal(runway.reviewSlotsPerCycle, state.config.voteReviewSlots.toString(), `${label} review timing changed`);
  assert.equal(runway.majorDelaySlotsPerCycle, state.config.majorDelaySlots.toString(), `${label} major delay changed`);
  assert.equal(runway.transitionSlotAllowance, CEREMONY_TRANSITION_SLOT_ALLOWANCE.toString(), `${label} transition allowance changed`);
  assert.equal(runway.safetyMarginSlots, CEREMONY_SEAT_TERM_SAFETY_SLOTS.toString(), `${label} safety margin changed`);
  assert(Array.isArray(runway.approvalSeatTermEndSlots) && runway.approvalSeatTermEndSlots.length === 3, `${label} approval-seat term vector changed`);
  state.council.seats.slice(0, 3).forEach((seat, index) => {
    assert.equal(runway.approvalSeatTermEndSlots[index], seat.termEndSlot.toString(), `${label} approval seat ${index} term changed`);
    assert(seat.termEndSlot > BigInt(runway.requiredTermEndSlot), `${label} approval seat ${index} no longer covers the planned ceremony`);
  });
  assert(BigInt(state.slot) < BigInt(runway.requiredTermEndSlot), `${label} exhausted its seat-term runway`);
}

function assertGate(gate, config, ids, expectedStatus = GateStatusV1.EmergencyFrozen) {
  assert.equal(gate.bump, ids.gateBump, "gate bump changed");
  assert(gate.controllerConfig.equals(ids.config), "gate config changed");
  assert(gate.targetProgram.equals(TARGET), "gate target changed");
  assert(gate.targetProgramdata.equals(TARGET_PROGRAMDATA), "gate ProgramData changed");
  assert.equal(gate.status, expectedStatus, "gate status changed");
  assert(gate.epoch > 0n, "gate epoch is zero");
  assert(gate.activeProposal.equals(PublicKey.default), "bootstrap gate has an active proposal");
  if (expectedStatus === GateStatusV1.EmergencyFrozen) {
    assert(gate.freezeSlot > 0n, "bootstrap gate freeze slot is zero");
    assert.equal(gate.freezeReasonCode, BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1, "bootstrap gate reason changed");
  } else if (expectedStatus === GateStatusV1.Active) {
    assert.equal(gate.freezeSlot, 0n, "active gate retained a freeze slot");
    assert.equal(gate.freezeReasonCode, 0, "active gate retained a freeze reason");
  } else {
    throw new Error("unsupported ceremony gate status");
  }
  assert(config.gatePda.equals(ids.gate), "config gate changed");
}

async function readBaseState(connection, inputs, minContextSlot = 0, expectedGateStatus = GateStatusV1.EmergencyFrozen) {
  const firstIds = derivedIdentities();
  const configResponse = await connection.getAccountInfoAndContext(firstIds.config, finalizedConfig(minContextSlot));
  assert(configResponse.context.slot >= minContextSlot, "config read predates the minimum context slot");
  const configAccount = assertAccount(configResponse.value, CONTROLLER, CONTROLLER_CONFIG_LEN, "controller config");
  const config = deserializeControllerConfigV1(configAccount.data);
  const ids = derivedIdentities(config.currentCouncilVersion);
  assertIdentityConfig(config, ids);
  const addresses = [
    CONTROLLER,
    CONTROLLER_PROGRAMDATA,
    ids.config,
    ids.policy,
    ids.council,
    ids.gate,
    ids.capacityPolicy,
    ids.immutabilityReceipt,
    TARGET,
    TARGET_PROGRAMDATA,
  ];
  const response = await connection.getMultipleAccountsInfoAndContext(addresses, finalizedConfig(configResponse.context.slot));
  assert(response.context.slot >= configResponse.context.slot, "base-state read predates its config read");
  assert.equal(response.value.length, addresses.length, "base-state account response length changed");
  const [
    controllerAccount,
    controllerProgramdataAccount,
    configAgainAccount,
    policyAccount,
    councilAccount,
    gateAccount,
    capacityAccount,
    immutabilityAccount,
    targetAccount,
    targetProgramdataAccount,
  ] = response.value;
  assertAccount(configAgainAccount, CONTROLLER, CONTROLLER_CONFIG_LEN, "controller config reread");
  assert(configAgainAccount.data.equals(configAccount.data), "controller config changed during one finalized observation");
  parseProgramAccount(controllerAccount, CONTROLLER_PROGRAMDATA, "controller Program");
  const controllerProgramdata = parseProgramdataAccount(controllerProgramdataAccount, "controller ProgramData");
  assert.equal(controllerProgramdata.authority, null, "controller is not immutable");
  parseProgramAccount(targetAccount, TARGET_PROGRAMDATA, "Spread Program");
  const targetProgramdata = parseProgramdataAccount(targetProgramdataAccount, "Spread ProgramData");
  const policy = deserializeGovernancePolicyFixedV1(
    assertAccount(policyAccount, CONTROLLER, GOVERNANCE_POLICY_LEN, "governance policy").data,
  );
  const council = deserializeGovernanceCouncilSetFixedV1(
    assertAccount(councilAccount, CONTROLLER, GOVERNANCE_COUNCIL_SET_LEN, "governance council").data,
  );
  const gate = deserializeProtocolGateV1(
    assertAccount(gateAccount, CONTROLLER, PROTOCOL_GATE_LEN, "protocol gate").data,
  );
  const capacity = deserializeProgramDataCapacityPolicyV1(
    assertAccount(capacityAccount, CONTROLLER, PROGRAMDATA_CAPACITY_POLICY_V1_LEN, "capacity policy").data,
  );
  validateProgramDataCapacityPolicyDigestV1(capacity);
  const immutability = deserializeControllerImmutabilityReceiptV1(
    assertAccount(immutabilityAccount, CONTROLLER, CONTROLLER_IMMUTABILITY_RECEIPT_V1_LEN, "controller immutability receipt").data,
  );
  validateControllerImmutabilityReceiptDigestV1(immutability);
  assertPolicyAndCouncil(policy, council, config, ids, response.context.slot);
  assertGate(gate, config, ids, expectedGateStatus);
  assert(capacity.controllerProgram.equals(CONTROLLER), "capacity controller changed");
  assert(capacity.controllerConfig.equals(ids.config), "capacity config changed");
  assert(capacity.targetProgram.equals(TARGET), "capacity target changed");
  assert(capacity.targetProgramdata.equals(TARGET_PROGRAMDATA), "capacity ProgramData changed");
  assert(capacity.upgradeableLoader.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), "capacity Loader changed");
  assert(capacity.artifactSchemeId.equals(ARTIFACT_MERKLE_SCHEME_ID), "capacity artifact scheme changed");
  assert.equal(capacity.artifactChunkSize, RELEASE1_ARTIFACT_CHUNK_SIZE_V1, "capacity artifact chunk size changed");
  assert(capacity.observationSchemeId.equals(PROGRAMDATA_OBSERVATION_MERKLE_SCHEME_ID_V1), "capacity raw-observation scheme changed");
  assert.equal(capacity.observationChunkSize, PROGRAMDATA_OBSERVATION_CHUNK_SIZE_16_KIB_V1, "capacity observation chunk size is not the selected 16-KiB policy");
  assert(immutability.finalized, "controller immutability receipt is not finalized");
  assert(immutability.controllerProgram.equals(CONTROLLER), "immutability controller changed");
  assert(immutability.controllerProgramdata.equals(CONTROLLER_PROGRAMDATA), "immutability ProgramData changed");
  assert(immutability.upgradeableLoader.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), "immutability Loader changed");
  assert(immutability.capacityPolicy.equals(ids.capacityPolicy), "immutability capacity policy changed");
  assert(immutability.capacityPolicyDigest.equals(capacity.policyDigest), "immutability capacity digest changed");
  compareOptionalKey(immutability.postUpgradeAuthority, null, "controller immutability post-authority");
  assert.equal(immutability.deployedSlot, controllerProgramdata.deployedSlot, "immutable controller deployed slot changed");
  assert.equal(immutability.rawProgramdataLength, BigInt(controllerProgramdata.raw.length), "immutable controller raw length changed");
  assert.equal(immutability.programdataCapacity, BigInt(controllerProgramdata.payload.length), "immutable controller capacity changed");
  assert(config.clusterDomain.equals(clusterDomainFromGenesisHashV1(EXPECTED_GENESIS)), "controller cluster domain changed");
  const payload = targetProgramdata.payload;
  assert(payload.length >= inputs.artifact.length, "Spread ProgramData capacity is below the bridge artifact length");
  assert(payload.subarray(0, inputs.artifact.length).equals(inputs.artifact), "Spread ProgramData payload is not the exact bridge artifact");
  assert(payload.subarray(inputs.artifact.length).every((byte) => byte === 0), "Spread ProgramData zero tail changed");
  const baseAccounts = {
    controllerProgram: controllerAccount,
    controllerProgramdata: controllerProgramdataAccount,
    controllerConfig: configAgainAccount,
    governancePolicy: policyAccount,
    governanceCouncil: councilAccount,
    protocolGate: gateAccount,
    capacityPolicy: capacityAccount,
    controllerImmutabilityReceipt: immutabilityAccount,
    targetProgram: targetAccount,
  };
  return {
    slot: response.context.slot,
    ids,
    config,
    policy,
    council,
    gate,
    capacity,
    immutability,
    controllerProgramdata,
    targetProgramdata,
    targetProgramdataAccount,
    targetProgramBytes: Buffer.from(targetAccount.data),
    baseFingerprints: Object.fromEntries(Object.entries(baseAccounts).map(([name, account]) => [name, accountFingerprint(account)])),
  };
}

function observationModel(inputs, state, options = {}) {
  const purpose = options.purpose ?? ProgramDataObservationPurposeV1.TargetHandoffBridge;
  const subject = options.subject ?? state.ids.immutabilityReceipt;
  const generation = options.generation ?? OBSERVATION_GENERATION;
  const expectedAuthority = options.expectedAuthority ?? LEGACY_AUTHORITY;
  assert(state.targetProgramdata.authority?.equals(expectedAuthority), "Spread ProgramData authority changed before its planned observation");
  const artifactSha = Buffer.from(inputs.artifactSha256, "hex");
  const subjectDigest = programDataObservationSubjectDigestV1({
    controllerProgram: CONTROLLER,
    controllerConfig: state.ids.config,
    targetProgram: TARGET,
    targetProgramdata: TARGET_PROGRAMDATA,
    purpose,
    subject,
    generation,
    protocolGate: state.ids.gate,
    gateStatus: state.gate.status,
    gateEpoch: state.gate.epoch,
    gateActiveProposal: state.gate.activeProposal,
    gateFreezeSlot: state.gate.freezeSlot,
    gateFreezeReasonCode: state.gate.freezeReasonCode,
    capacityPolicyDigest: state.capacity.policyDigest,
    expectedArtifactLength: BigInt(inputs.artifact.length),
    expectedArtifactSha256: artifactSha,
    expectedArtifactMerkleRoot: inputs.artifactMerkle,
    expectedArtifactSchemeId: ARTIFACT_MERKLE_SCHEME_ID,
    minimumRequiredCapacity: BigInt(inputs.artifact.length),
  });
  const [observation, observationBump] = deriveProgramDataObservationPdaV1(
    CONTROLLER,
    TARGET,
    purpose,
    subjectDigest,
    generation,
  );
  const guard = {
    purpose,
    generation,
    expectedSubjectDigest: subjectDigest,
    expectedGateStatus: state.gate.status,
    expectedGateEpoch: state.gate.epoch,
    expectedFreezeReasonCode: state.gate.freezeReasonCode,
    expectedFreezeSlot: state.gate.freezeSlot,
  };
  const beginAccounts = {
    payer: PAYER,
    controllerConfig: state.ids.config,
    protocolGate: state.ids.gate,
    capacityPolicy: state.ids.capacityPolicy,
    subject,
    observedProgram: TARGET,
    observedProgramdata: TARGET_PROGRAMDATA,
    observation,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  };
  const stepAccounts = {
    controllerConfig: state.ids.config,
    protocolGate: state.ids.gate,
    capacityPolicy: state.ids.capacityPolicy,
    subject,
    observedProgram: TARGET,
    observedProgramdata: TARGET_PROGRAMDATA,
    observation,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  };
  const rawGeometry = programDataObservationGeometryV1(
    state.targetProgramdata.raw.length,
    state.capacity.observationChunkSize,
  );
  const artifactChunks = artifactChunkCount(inputs.artifact.length, RELEASE1_ARTIFACT_CHUNK_SIZE_V1);
  const tailBytes = BigInt(state.targetProgramdata.payload.length - inputs.artifact.length);
  const begin = buildBeginProgramDataObservationV1Instruction(CONTROLLER, beginAccounts, {
    guard,
    expectedCapacityPolicyDigest: state.capacity.policyDigest,
    expectedArtifactLength: BigInt(inputs.artifact.length),
    expectedArtifactSha256: artifactSha,
    expectedArtifactMerkleRoot: inputs.artifactMerkle,
    expectedArtifactSchemeId: ARTIFACT_MERKLE_SCHEME_ID,
    minimumRequiredCapacity: BigInt(inputs.artifact.length),
    expectedDeployedSlot: state.targetProgramdata.deployedSlot,
    expectedActualCapacity: BigInt(state.targetProgramdata.payload.length),
    expectedUpgradeAuthority: { present: true, value: expectedAuthority },
  });
  const appends = Array.from({ length: rawGeometry.chunkCount }, (_, chunkIndex) => (
    buildAppendProgramDataObservationChunkV1Instruction(CONTROLLER, stepAccounts, {
      guard,
      expectedStatus: ProgramDataObservationStatusV1.Accumulating,
      chunkIndex,
    })
  ));
  const verifies = Array.from({ length: artifactChunks }, (_, chunkIndex) => {
    const proof = artifactMerkleProof(inputs.artifact, chunkIndex, RELEASE1_ARTIFACT_CHUNK_SIZE_V1);
    assert(proof.length <= 7, "Spread artifact proof exceeds the fixed seven-node ABI");
    return buildVerifyObservedArtifactChunkV1Instruction(CONTROLLER, stepAccounts, {
      guard,
      expectedStatus: ProgramDataObservationStatusV1.Accumulating,
      chunkIndex,
      expectedNextArtifactChunkIndex: chunkIndex,
      expectedTailBytesVerified: tailBytes,
      proof: {
        proofLen: proof.length,
        nodes: [
          ...proof.map((entry) => Buffer.from(entry)),
          ...Array.from({ length: 7 - proof.length }, () => Buffer.from(ZERO_32)),
        ],
      },
    });
  });
  const finalize = buildFinalizeProgramDataObservationV1Instruction(CONTROLLER, stepAccounts, {
    guard,
    expectedStatus: ProgramDataObservationStatusV1.ReadyToFinalize,
    expectedNextRawChunkIndex: rawGeometry.chunkCount,
    expectedNextArtifactChunkIndex: artifactChunks,
    expectedTailBytesVerified: tailBytes,
  });
  return {
    observation,
    observationBump,
    subjectDigest,
    guard,
    begin,
    appends,
    verifies,
    finalize,
    rawGeometry,
    artifactChunks,
    tailBytes,
    rawSha256: programDataRawSha256ReceiptV1(state.targetProgramdata.raw),
    rawRoot: programDataObservationMerkleRootV1(
      state.targetProgramdata.raw,
      subjectDigest,
      state.capacity.observationChunkSize,
    ),
  };
}

function activationObservationModel(inputs, state) {
  return observationModel(inputs, state, {
    purpose: ProgramDataObservationPurposeV1.BootstrapActivation,
    subject: state.ids.handoffReceipt,
    generation: ACTIVATION_OBSERVATION_GENERATION,
    expectedAuthority: state.ids.authority,
  });
}

function observationInstructions(model, prefix = "observation") {
  return [
    { stage: `${prefix}-begin`, instructions: [...computePrefix(), model.begin], signers: [PAYER] },
    ...model.appends.map((instruction, index) => ({
      stage: `${prefix}-raw-${String(index).padStart(3, "0")}`,
      instructions: [...computePrefix(), instruction],
      signers: [PAYER],
    })),
    ...model.verifies.map((instruction, index) => ({
      stage: `${prefix}-artifact-${String(index).padStart(3, "0")}`,
      instructions: [...computePrefix(), instruction],
      signers: [PAYER],
    })),
    { stage: `${prefix}-finalize`, instructions: [...computePrefix(), model.finalize], signers: [PAYER] },
  ];
}

function handoffAccounts(state, model) {
  const common = {
    controllerProgram: CONTROLLER,
    controllerProgramdata: CONTROLLER_PROGRAMDATA,
    controllerConfig: state.ids.config,
    governancePolicy: state.ids.policy,
    council: state.ids.council,
    protocolGate: state.ids.gate,
    capacityPolicy: state.ids.capacityPolicy,
    immutabilityReceipt: state.ids.immutabilityReceipt,
    bridgeObservation: model.observation,
    targetProgram: TARGET,
    targetProgramdata: TARGET_PROGRAMDATA,
    legacyAuthority: LEGACY_AUTHORITY,
    controllerAuthority: state.ids.authority,
    proposal: state.ids.handoffProposal,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  };
  return {
    common,
    create: {
      payer: PAYER,
      creator: SEATS[0],
      ...common,
      systemProgram: SystemProgram.programId,
    },
    accept: {
      payer: PAYER,
      controllerProgram: CONTROLLER,
      controllerProgramdata: CONTROLLER_PROGRAMDATA,
      controllerConfig: state.ids.config,
      governancePolicy: state.ids.policy,
      council: state.ids.council,
      protocolGate: state.ids.gate,
      capacityPolicy: state.ids.capacityPolicy,
      immutabilityReceipt: state.ids.immutabilityReceipt,
      proposal: state.ids.handoffProposal,
      bridgeObservation: model.observation,
      targetProgram: TARGET,
      targetProgramdata: TARGET_PROGRAMDATA,
      legacyAuthority: LEGACY_AUTHORITY,
      controllerAuthority: state.ids.authority,
      upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
      handoffReceipt: state.ids.handoffReceipt,
      systemProgram: SystemProgram.programId,
      instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
    },
  };
}

function activationAccounts(state, observation) {
  const common = {
    controllerProgram: CONTROLLER,
    controllerProgramdata: CONTROLLER_PROGRAMDATA,
    controllerConfig: state.ids.config,
    governancePolicy: state.ids.policy,
    council: state.ids.council,
    protocolGate: state.ids.gate,
    capacityPolicy: state.ids.capacityPolicy,
    immutabilityReceipt: state.ids.immutabilityReceipt,
    handoffReceipt: state.ids.handoffReceipt,
    bridgeObservation: observation,
    targetProgram: TARGET,
    targetProgramdata: TARGET_PROGRAMDATA,
    controllerAuthority: state.ids.authority,
    proposal: state.ids.activationProposal,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  };
  return {
    common,
    create: {
      payer: PAYER,
      creator: SEATS[0],
      ...common,
      activationReceipt: state.ids.activationReceipt,
      currentDeployment: state.ids.currentDeployment,
      systemProgram: SystemProgram.programId,
    },
    execute: {
      controllerProgram: CONTROLLER,
      controllerProgramdata: CONTROLLER_PROGRAMDATA,
      controllerConfig: state.ids.config,
      governancePolicy: state.ids.policy,
      council: state.ids.council,
      protocolGate: state.ids.gate,
      capacityPolicy: state.ids.capacityPolicy,
      immutabilityReceipt: state.ids.immutabilityReceipt,
      handoffReceipt: state.ids.handoffReceipt,
      proposal: state.ids.activationProposal,
      bridgeObservation: observation,
      targetProgram: TARGET,
      targetProgramdata: TARGET_PROGRAMDATA,
      controllerAuthority: state.ids.authority,
      upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
      activationReceipt: state.ids.activationReceipt,
      currentDeployment: state.ids.currentDeployment,
      instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
    },
  };
}

function activationPlanDigests(state, observationAddress, observation, handoff, proposalDigest) {
  const nextEpoch = state.gate.epoch + 1n;
  const deployment = {
    discriminator: Buffer.from(CURRENT_DEPLOYMENT_STATE_V1_DISCRIMINATOR),
    version: CEREMONY_ACCOUNT_VERSION_V1,
    bump: state.ids.currentDeploymentBump,
    initialized: true,
    controllerProgram: CONTROLLER,
    controllerConfig: state.ids.config,
    capacityPolicy: state.ids.capacityPolicy,
    capacityPolicyDigest: observation.capacityPolicyDigest,
    targetProgram: TARGET,
    targetProgramdata: TARGET_PROGRAMDATA,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    controllerAuthority: state.ids.authority,
    artifactLength: handoff.artifactLength,
    artifactSha256: handoff.artifactSha256,
    artifactMerkleRoot: handoff.artifactMerkleRoot,
    artifactSchemeId: handoff.artifactSchemeId,
    actualProgramdataCapacity: observation.actualCapacity,
    programdataObservation: observationAddress,
    observationGeneration: observation.generation,
    observationRoot: observation.finalRawMerkleRoot,
    observationDigest: observation.observationDigest,
    deployedSlot: observation.deployedSlot,
    installedAuthority: state.ids.authority,
    sourceCommitment: handoff.bridgeSourceCommitment,
    buildInputsCommitment: handoff.bridgeBuildInputsCommitment,
    packageCommitment: handoff.bridgePackageCommitment,
    releaseManifestCommitment: handoff.bridgeReleaseManifestCommitment,
    releaseCommitment: state.ids.handoffReceipt,
    releaseCommitmentDigest: handoff.receiptDigest,
    activationReceipt: { present: true, value: state.ids.activationReceipt },
    completedProposal: { present: false, value: PublicKey.default },
    gateEpochAtActivation: nextEpoch,
    deploymentGeneration: 1n,
    deploymentDigest: Buffer.from(ZERO_32),
    lastUpdatedSlot: 0n,
    reserved: Buffer.alloc(CURRENT_DEPLOYMENT_STATE_V1_RESERVED_LEN),
  };
  const receipt = {
    discriminator: Buffer.from(BOOTSTRAP_ACTIVATION_RECEIPT_V1_DISCRIMINATOR),
    version: CEREMONY_ACCOUNT_VERSION_V1,
    bump: state.ids.activationReceiptBump,
    initialized: true,
    proposal: state.ids.activationProposal,
    proposalDigest,
    controllerProgram: CONTROLLER,
    controllerConfig: state.ids.config,
    governancePolicy: state.ids.policy,
    governancePolicyHash: state.policy.policyHash,
    capacityPolicy: state.ids.capacityPolicy,
    capacityPolicyDigest: observation.capacityPolicyDigest,
    controllerImmutabilityReceipt: state.ids.immutabilityReceipt,
    controllerImmutabilityDigest: state.immutability.receiptDigest,
    targetHandoffReceipt: state.ids.handoffReceipt,
    targetHandoffDigest: handoff.receiptDigest,
    gate: state.ids.gate,
    targetProgram: TARGET,
    targetProgramdata: TARGET_PROGRAMDATA,
    upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    controllerAuthority: state.ids.authority,
    bridgeObservation: deployment.programdataObservation,
    bridgeObservationGeneration: observation.generation,
    bridgeObservationRoot: observation.finalRawMerkleRoot,
    bridgeObservationDigest: observation.observationDigest,
    bridgeArtifactLength: handoff.artifactLength,
    bridgeArtifactSha256: handoff.artifactSha256,
    bridgeArtifactMerkleRoot: handoff.artifactMerkleRoot,
    bridgeArtifactSchemeId: handoff.artifactSchemeId,
    actualTargetCapacity: observation.actualCapacity,
    targetDeployedSlot: observation.deployedSlot,
    previousGateStatus: GateStatusV1.EmergencyFrozen,
    previousGateEpoch: state.gate.epoch,
    previousFreezeReasonCode: state.gate.freezeReasonCode,
    previousFreezeSlot: state.gate.freezeSlot,
    activatedGateStatus: GateStatusV1.Active,
    activatedGateEpoch: nextEpoch,
    targetNonce: state.config.targetNonce,
    councilVersion: state.council.version,
    councilHash: state.council.setHash,
    currentDeploymentState: state.ids.currentDeployment,
    currentDeploymentDigest: Buffer.from(ZERO_32),
    deploymentGeneration: 1n,
    finalizedSlot: 0n,
    receiptDigest: Buffer.from(ZERO_32),
    finalized: true,
    reserved: Buffer.alloc(BOOTSTRAP_ACTIVATION_RECEIPT_V1_RESERVED_LEN),
  };
  return {
    deployment,
    receipt,
    deploymentPlanDigest: bootstrapActivationDeploymentPlanDigestV1(deployment),
    receiptPlanDigest: bootstrapActivationReceiptPlanDigestV1(receipt),
  };
}

function evidencePlan(inputs) {
  const bridge = inputs.bridgeEvidence;
  assert(inputs.frozenGateCensus, "frozen-gate instruction census is absent");
  return {
    sourceEvidenceSha256: inputs.evidence.source.sha256,
    buildInputsEvidenceSha256: inputs.evidence.buildInputs.sha256,
    packageEvidenceSha256: inputs.evidence.packageReceipt.sha256,
    releaseManifestSha256: inputs.evidence.releaseManifest.sha256,
    releaseManifestSchema: inputs.evidence.manifest.schema,
    productionUseAuthorized: inputs.evidence.manifest.productionUseAuthorized,
    ceremonyBuildReceiptFile: path.basename(inputs.evidence.source.file),
    ceremonyBuildSourceCommit: inputs.evidence.buildReceipt.source.commit,
    ceremonyBuildSourceTree: inputs.evidence.buildReceipt.source.tree,
    ceremonyBuildInventoryFile: path.basename(inputs.evidence.buildInputs.file),
    ceremonyBuildInventoryAggregateSha256: inputs.evidence.buildInventory.value.summary.aggregateSha256,
    phase3InstructionManifestFile: path.basename(inputs.evidence.phase3ManifestEvidence.file),
    phase3InstructionManifestRawSha256: inputs.evidence.phase3ManifestEvidence.sha256,
    frozenGateCensusFile: path.basename(inputs.frozenGateCensus.file),
    frozenGateCensusRawSha256: inputs.frozenGateCensus.sha256,
    frozenGateCensusSha256: inputs.frozenGateCensus.receipt.receiptSha256,
    frozenGateCensusObservedSlot: inputs.frozenGateCensus.receipt.observedSlotAfter,
    frozenGateAssignedMutatorCount: inputs.frozenGateCensus.receipt.assignedMutatorCount,
    frozenGateUnknownCount: inputs.frozenGateCensus.receipt.unknownCount,
    frozenGateReservedCount: inputs.frozenGateCensus.receipt.reservedCount,
    bridgeUpgradeReceiptFile: path.basename(bridge.wrapper.file),
    bridgeUpgradeReceiptRawSha256: bridge.wrapper.sha256,
    bridgeUpgradeReceiptSha256: bridge.wrapper.value.receiptSha256,
    compatibilityAdapterSha256: bridge.wrapper.value.compatibilityAdapterSha256,
    formerAuthorityProofBuffer: bridge.proofBuffer.toBase58(),
    formerAuthorityProofBufferRawSha256: bridge.wrapper.value.formerAuthorityProofBufferRawSha256,
    authoritativePostSummaryFile: path.basename(bridge.summary.file),
    authoritativePostSummaryRawSha256: bridge.summary.sha256,
    authoritativePostSummarySha256: bridge.summary.value.summarySha256,
    authoritativeUpgradeReceiptFile: path.basename(bridge.upgradeReceipt.file),
    authoritativeUpgradeReceiptRawSha256: bridge.upgradeReceipt.sha256,
    authoritativeUpgradeReceiptSha256: bridge.upgradeReceipt.value.receiptSha256,
    authoritativePostProgramDataRawFile: path.basename(bridge.postRaw.file),
    authoritativePostProgramDataRawSha256: bridge.postRaw.sha256,
    poststateRepeatReceiptFile: path.basename(bridge.repeatReceipt.file),
    poststateRepeatReceiptRawSha256: bridge.repeatReceipt.sha256,
    poststateRepeatReceiptSha256: bridge.repeatReceipt.value.receiptSha256,
    poststateRepeatCensusFile: path.basename(bridge.repeatCensus.file),
    poststateRepeatCensusRawSha256: bridge.repeatCensus.sha256,
    poststateRepeatProgramDataRawFile: path.basename(bridge.repeatRaw.file),
    poststateRepeatProgramDataRawSha256: bridge.repeatRaw.sha256,
    firstPostFinalizedContextSlot: bridge.wrapper.value.finalizedContextSlot,
    repeatCaptureStartSlot: bridge.repeatReceipt.value.repeat.compatibilityObservation.captureStartSlot,
    repeatContextSlot: bridge.repeatReceipt.value.repeat.contextSlot,
    repeatHistoryThroughSlot: bridge.repeatReceipt.value.historyExclusion.throughInclusiveSlot,
    repeatStateRpcProviderOriginSha256: bridge.repeatReceipt.value.historyExclusion.stateRpcProviderOriginSha256,
    repeatHistoryRpcProviderOriginSha256: bridge.repeatReceipt.value.historyExclusion.historyRpcProviderOriginSha256,
    repeatObservedHistorySha256: bridge.repeatReceipt.value.historyExclusion.observedHistorySha256,
    successfulTargetMutationsAfterFirstPost: bridge.repeatReceipt.value.historyExclusion.successfulTargetMutationCountAfterBoundary,
    firstPostCompatibilityInventorySha256: bridge.inventories.firstInventorySha256,
    repeatCompatibilityInventorySha256: bridge.inventories.repeatInventorySha256,
    secondIndependentCensusSatisfied: bridge.repeatReceipt.value.comparison.step8SecondIndependentCensusSatisfied,
    commitmentEncoding: "exact SHA-256 of each secure evidence file",
  };
}

function modelAsFinalObservation(state, model, digest = ZERO_32) {
  return {
    address: model.observation,
    generation: model.guard.generation,
    capacityPolicyDigest: state.capacity.policyDigest,
    actualCapacity: BigInt(state.targetProgramdata.payload.length),
    finalRawMerkleRoot: model.rawRoot,
    observationDigest: Buffer.from(digest),
    deployedSlot: state.targetProgramdata.deployedSlot,
  };
}

async function readActivationProgress(connection, plan, minContextSlot = 0) {
  const addresses = [
    publicKey(plan.observation.account, "activation observation"),
    publicKey(plan.activation.proposal, "activation proposal"),
    publicKey(plan.activation.receipt, "activation receipt"),
    publicKey(plan.activation.currentDeployment, "current deployment"),
  ];
  const response = await connection.getMultipleAccountsInfoAndContext(addresses, finalizedConfig(minContextSlot));
  assert(response.context.slot >= minContextSlot, "activation progress read predates its minimum context slot");
  const [observationAccount, proposalAccount, receiptAccount, deploymentAccount] = response.value;
  const decodeOrVacant = (account, owner, length, label, decode) => {
    if (!account || (account.owner.equals(SystemProgram.programId) && account.data.length === 0)) {
      assertVacant(account, label);
      return null;
    }
    return decode(assertAccount(account, owner, length, label).data);
  };
  return {
    slot: response.context.slot,
    accounts: response.value,
    observation: decodeOrVacant(observationAccount, CONTROLLER, PROGRAMDATA_OBSERVATION_V1_LEN, "activation observation", deserializeProgramDataObservationV1),
    proposal: decodeOrVacant(proposalAccount, CONTROLLER, BOOTSTRAP_ACTIVATION_PROPOSAL_V1_LEN, "activation proposal", deserializeBootstrapActivationProposalV1),
    receipt: decodeOrVacant(receiptAccount, CONTROLLER, BOOTSTRAP_ACTIVATION_RECEIPT_V1_LEN, "activation receipt", deserializeBootstrapActivationReceiptV1),
    deployment: decodeOrVacant(deploymentAccount, CONTROLLER, CURRENT_DEPLOYMENT_STATE_V1_LEN, "current deployment", deserializeCurrentDeploymentStateV1),
  };
}

async function readActivationLiveState(
  connection,
  inputs,
  plan,
  minContextSlot = 0,
  proofBufferCloseReceipt = null,
) {
  const handoffAcceptedSlot = Number(plan.handoff.acceptedSlot);
  assert(Number.isSafeInteger(handoffAcceptedSlot) && handoffAcceptedSlot > 0, "planned handoff accepted slot is invalid");
  const evidenceMinContextSlot = Math.max(
    minContextSlot,
    plan.plannedAtSlot,
    inputs.proofReceipt.finalizedSlot,
    handoffAcceptedSlot,
    proofBufferCloseReceipt?.receipt?.finalizedSlot ?? 0,
  );
  const gateAddress = publicKey(plan.identities.protocolGate, "planned protocol gate");
  const gateRead = await connection.getAccountInfoAndContext(gateAddress, finalizedConfig(evidenceMinContextSlot));
  assert(gateRead.context.slot >= evidenceMinContextSlot, "activation gate-status read predates its evidence boundary");
  const gatePreview = deserializeProtocolGateV1(
    assertAccount(gateRead.value, CONTROLLER, PROTOCOL_GATE_LEN, "protocol gate preview").data,
  );
  assert(
    [GateStatusV1.EmergencyFrozen, GateStatusV1.Active].includes(gatePreview.status),
    "activation gate is neither bootstrap-frozen nor Active",
  );
  const state = await readBaseState(connection, inputs, gateRead.context.slot, gatePreview.status);
  assert(state.targetProgramdata.authority?.equals(state.ids.authority), "target authority is not the controller PDA");
  const dependencyAddresses = [
    state.ids.handoffProposal,
    state.ids.handoffReceipt,
    inputs.proofBuffer,
    TREASURY,
  ];
  const dependencies = await connection.getMultipleAccountsInfoAndContext(
    dependencyAddresses,
    finalizedConfig(state.slot),
  );
  assert(dependencies.context.slot >= state.slot, "activation dependency read predates base state");
  const [handoffProposalAccount, handoffReceiptAccount, proofBufferAccount, treasuryAccount] = dependencies.value;
  const handoffProposal = deserializeTargetAuthorityHandoffProposalV1(
    assertAccount(handoffProposalAccount, CONTROLLER, TARGET_AUTHORITY_HANDOFF_PROPOSAL_V1_LEN, "handoff proposal dependency").data,
  );
  const handoffReceipt = deserializeTargetAuthorityHandoffReceiptV1(
    assertAccount(handoffReceiptAccount, CONTROLLER, TARGET_AUTHORITY_HANDOFF_RECEIPT_V1_LEN, "handoff receipt dependency").data,
  );
  validateTargetAuthorityHandoffProposalDigestV1(handoffProposal);
  validateTargetAuthorityHandoffReceiptDigestV1(handoffReceipt);
  assert.equal(handoffProposal.state, CeremonyProposalStateV1.Completed, "handoff proposal is not completed");
  assert.equal(handoffProposal.proposalDigest.toString("hex"), plan.handoff.proposalDigest, "handoff proposal digest changed");
  assert.equal(handoffReceipt.receiptDigest.toString("hex"), plan.handoff.receiptDigest, "handoff receipt digest changed");
  assert(handoffReceipt.proposal.equals(state.ids.handoffProposal) && handoffReceipt.proposalDigest.equals(handoffProposal.proposalDigest), "handoff receipt proposal graph changed");
  assert.equal(handoffReceipt.acceptedSlot.toString(), plan.handoff.acceptedSlot, "handoff accepted slot changed");
  if (proofBufferCloseReceipt) {
    assertVacant(proofBufferAccount, "closed former-authority proof buffer");
  } else {
    parseBufferAccount(proofBufferAccount, inputs);
  }
  assert(treasuryAccount, "canonical spill treasury is absent");
  const progress = await readActivationProgress(connection, plan, dependencies.context.slot);
  state.slot = progress.slot;

  const { protocolGate: plannedGateFingerprint, ...plannedBase } = plan.baseAccountFingerprints;
  const { protocolGate: currentGateFingerprint, ...currentBase } = {
    ...state.baseFingerprints,
    targetProgramdata: accountFingerprint(state.targetProgramdataAccount),
    handoffProposal: accountFingerprint(handoffProposalAccount),
    handoffReceipt: accountFingerprint(handoffReceiptAccount),
    proofBuffer: accountFingerprint(proofBufferAccount),
    spillTreasury: accountFingerprint(treasuryAccount),
  };
  if (proofBufferCloseReceipt) {
    const { proofBuffer: plannedProofBuffer, ...plannedAfterClose } = plannedBase;
    const { proofBuffer: currentProofBuffer, ...currentAfterClose } = currentBase;
    assert.equal(currentProofBuffer, null, "closed proof buffer unexpectedly exists");
    if (plan.negative.proofBufferClosedBeforePlanning) {
      assert.equal(plannedProofBuffer, null, "replanned activation unexpectedly binds a live proof buffer");
      assert.deepEqual(currentAfterClose, plannedAfterClose, "replanned activation static account graph changed");
    } else {
      assert(plannedProofBuffer, "activation plan did not bind the original proof buffer");
      assert.deepEqual(currentAfterClose, plannedAfterClose, "activation static account graph changed after the exact proof-buffer close");
    }
  } else {
    assert.deepEqual(currentBase, plannedBase, "activation static account graph changed since planning");
  }
  if (state.gate.status === GateStatusV1.EmergencyFrozen) {
    assert.deepEqual(currentGateFingerprint, plannedGateFingerprint, "bootstrap-frozen gate changed since activation planning");
    assert.equal(state.gate.epoch.toString(), plan.gate.epoch, "bootstrap gate epoch changed");
    assert.equal(state.gate.freezeSlot.toString(), plan.gate.freezeSlot, "bootstrap gate freeze slot changed");
    assert.equal(state.gate.freezeReasonCode, plan.gate.freezeReasonCode, "bootstrap gate freeze reason changed");
  } else {
    assert.equal(state.gate.epoch.toString(), plan.gate.nextEpoch, "active gate epoch changed");
    assert(state.gate.lastCompletedProposal.equals(state.ids.activationProposal), "active gate last-completed proposal changed");
  }
  assert.equal(state.config.targetNonce.toString(), plan.governance.targetNonce, "activation target nonce changed");
  assert.equal(state.council.version.toString(), plan.governance.councilVersion, "activation council version changed");
  assert.equal(state.council.setHash.toString("hex"), plan.governance.councilHash, "activation council hash changed");
  assert.equal(state.policy.policyHash.toString("hex"), plan.governance.policyHash, "activation policy hash changed");
  if (proofBufferCloseReceipt?.replanning !== true) {
    assertApprovalSeatRunway(plan, state, "bootstrap activation plan");
  }
  assert.equal(state.targetProgramdata.deployedSlot.toString(), plan.programdata.deployedSlot, "target deployed slot changed");
  assert.equal(state.targetProgramdata.raw.length, plan.programdata.rawBytes, "target raw length changed");
  assert.equal(state.targetProgramdata.payload.length, plan.programdata.capacity, "target capacity changed");
  assert.equal(state.targetProgramdata.header.toString("hex"), plan.programdata.headerHex, "target ProgramData header changed");
  assert.equal(sha256Hex(state.targetProgramdata.raw), plan.programdata.rawSha256, "target ProgramData raw hash changed");
  assert.equal(sha256Hex(state.targetProgramdata.payload), plan.programdata.payloadSha256, "target payload hash changed");

  if (!progress.proposal && proofBufferCloseReceipt?.replanning !== true) {
    assert(BigInt(state.slot) <= BigInt(plan.planValidUntilSlot), "bootstrap activation creation plan expired");
  }
  if (progress.observation) {
    assertObservationAgainstPlan(progress.observation, plan, state, "activation observation", {
      purpose: ProgramDataObservationPurposeV1.BootstrapActivation,
      subject: state.ids.handoffReceipt,
      generation: ACTIVATION_OBSERVATION_GENERATION,
      expectedAuthority: state.ids.authority,
      expectedHeaderHex: plan.programdata.headerHex,
      expectedGateStatus: plan.gate.status,
      expectedGateEpoch: BigInt(plan.gate.epoch),
      expectedGateActiveProposal: publicKey(plan.gate.activeProposal, "planned gate active proposal"),
      expectedGateFreezeSlot: BigInt(plan.gate.freezeSlot),
      expectedGateFreezeReasonCode: plan.gate.freezeReasonCode,
    });
  }
  if (progress.proposal) {
    assert(progress.observation, "activation proposal exists without its observation");
    assert.equal(progress.observation.status, ProgramDataObservationStatusV1.Finalized, "activation proposal exists before observation finalization");
    assertActivationProposalAgainstPlan(progress.proposal, plan, state, progress.observation, handoffReceipt);
  }
  if (progress.receipt || progress.deployment) {
    assert(progress.receipt && progress.deployment && progress.proposal && progress.observation, "activation final accounts are incomplete");
    assert.equal(state.gate.status, GateStatusV1.Active, "activation final accounts exist while gate is not Active");
    assert.equal(progress.proposal.state, CeremonyProposalStateV1.Completed, "activation final accounts exist before proposal completion");
    assertActivationFinalAccounts(progress.receipt, progress.deployment, progress.proposal, plan, state, progress.observation, handoffReceipt);
  } else {
    assert.equal(state.gate.status, GateStatusV1.EmergencyFrozen, "gate activated without atomic activation receipt/deployment state");
    assert(!progress.proposal || progress.proposal.state !== CeremonyProposalStateV1.Completed, "completed activation proposal lacks final accounts");
  }
  return {
    state,
    handoffProposal,
    handoffReceipt,
    handoffProposalAccount,
    handoffReceiptAccount,
    proofBufferAccount,
    treasuryAccount,
    progress,
    model: state.gate.status === GateStatusV1.EmergencyFrozen
      ? activationObservationModel(inputs, state)
      : null,
  };
}

function buildActivationPlanMaterial(inputs, state, handoffPlan, handoffProgress, model, proofAccount, treasuryAccount, rpcConfiguration, toolSha256, recovery = null) {
  const observationAddress = model.observation;
  const accounts = activationAccounts(state, observationAddress);
  const planValidUntilSlot = BigInt(state.slot) + BigInt(PLAN_TTL_SLOTS);
  const placeholderDigest = hashBytes(Buffer.from("AMOEBA_ACTIVATION_PROPOSAL_DIGEST_PLACEHOLDER_V1", "ascii"));
  const placeholderObservation = modelAsFinalObservation(state, model, placeholderDigest);
  const planDigests = activationPlanDigests(
    state,
    observationAddress,
    placeholderObservation,
    handoffProgress.receipt,
    placeholderDigest,
  );
  const create = buildCreateBootstrapActivationV1Instruction(CONTROLLER, accounts.create, {
    expectedControllerImmutabilityDigest: state.immutability.receiptDigest,
    expectedHandoffReceiptDigest: handoffProgress.receipt.receiptDigest,
    expectedBridgeObservationDigest: placeholderDigest,
    expectedGateEpoch: state.gate.epoch,
    expectedTargetNonce: state.config.targetNonce,
    expectedCouncilVersion: state.council.version,
    planValidUntilSlot,
  });
  const approvalValue = {
    expectedProposalDigest: placeholderDigest,
    expectedCouncilVersion: state.council.version,
    expectedGateEpoch: state.gate.epoch,
    expectedTargetNonce: state.config.targetNonce,
  };
  const approvals = SEATS.slice(0, 3).map((seatAuthority, index) => ({
    stage: `activation-approve-${index}`,
    dynamicFields: ["expectedProposalDigest"],
    ...normalizedPacket([
      buildApproveBootstrapActivationV1Instruction(CONTROLLER, { ...accounts.common, seatAuthority }, approvalValue),
    ], [PAYER, seatAuthority]),
  }));
  const queue = buildQueueBootstrapActivationV1Instruction(CONTROLLER, accounts.common, approvalValue);
  const execute = buildExecuteBootstrapActivationV1Instruction(CONTROLLER, accounts.execute, {
    expectedProposalDigest: placeholderDigest,
    expectedBridgeObservationDigest: placeholderDigest,
    expectedGateEpoch: state.gate.epoch,
    expectedTargetNonce: state.config.targetNonce,
    expectedDeploymentPlanDigest: planDigests.deploymentPlanDigest,
    expectedReceiptPlanDigest: planDigests.receiptPlanDigest,
    envelope: envelope(),
  });
  const observation = observationInstructions(model, "activation-observation").map((entry) => ({
    stage: entry.stage,
    dynamicFields: [],
    ...normalizedPacket(entry.instructions, entry.signers),
  }));
  const approvalRunway = approvalSeatRunway(state, 1, observation.length, "bootstrap activation");
  const negativeInstruction = directFormerAuthorityUpgradeInstruction(inputs.proofBuffer);
  const closeInstruction = directFormerAuthorityCloseBufferInstruction(inputs.proofBuffer);
  return {
    schema: ACTIVATION_PLAN_SCHEMA,
    mainnetAllowed: false,
    cluster: {
      genesisHash: EXPECTED_GENESIS,
      clusterDomainHex: state.config.clusterDomain.toString("hex"),
      commitment: "finalized",
    },
    rpc: {
      selection: rpcConfiguration.rpcSelection,
      providerOriginSha256: originCommitment(rpcConfiguration.stateRpcOrigin),
    },
    plannedAtSlot: state.slot,
    planValidUntilSlot: planValidUntilSlot.toString(),
    identities: {
      controllerProgram: CONTROLLER.toBase58(),
      controllerProgramdata: CONTROLLER_PROGRAMDATA.toBase58(),
      controllerConfig: state.ids.config.toBase58(),
      controllerAuthority: state.ids.authority.toBase58(),
      governancePolicy: state.ids.policy.toBase58(),
      governanceCouncil: state.ids.council.toBase58(),
      protocolGate: state.ids.gate.toBase58(),
      capacityPolicy: state.ids.capacityPolicy.toBase58(),
      controllerImmutabilityReceipt: state.ids.immutabilityReceipt.toBase58(),
      handoffProposal: state.ids.handoffProposal.toBase58(),
      handoffReceipt: state.ids.handoffReceipt.toBase58(),
      targetProgram: TARGET.toBase58(),
      targetProgramdata: TARGET_PROGRAMDATA.toBase58(),
      proofBuffer: inputs.proofBuffer.toBase58(),
      legacyAuthority: LEGACY_AUTHORITY.toBase58(),
      spillTreasury: TREASURY.toBase58(),
      activationProposal: state.ids.activationProposal.toBase58(),
      activationReceipt: state.ids.activationReceipt.toBase58(),
      currentDeployment: state.ids.currentDeployment.toBase58(),
      payer: PAYER.toBase58(),
      seats: SEATS.map((entry) => entry.toBase58()),
      upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58(),
    },
    baseAccountFingerprints: {
      ...state.baseFingerprints,
      targetProgramdata: accountFingerprint(state.targetProgramdataAccount),
      handoffProposal: accountFingerprint(handoffProgress.accounts[1]),
      handoffReceipt: accountFingerprint(handoffProgress.accounts[2]),
      proofBuffer: accountFingerprint(proofAccount),
      spillTreasury: accountFingerprint(treasuryAccount),
    },
    artifact: {
      bytes: inputs.artifact.length,
      sha256: inputs.artifactSha256,
      merkleRoot: inputs.artifactMerkle.toString("hex"),
      schemeId: ARTIFACT_MERKLE_SCHEME_ID.toString("hex"),
      chunkSize: RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
      chunkCount: model.artifactChunks,
    },
    evidence: {
      ...evidencePlan(inputs),
      handoffPlanOperationId: handoffPlan.operationId,
      handoffLocalReceiptSha256: inputs.handoffLocalReceiptSha256,
      handoffReceiptAccountSha256: sha256Hex(handoffProgress.accounts[2].data),
      proofBufferReceiptSha256: inputs.proofReceiptSha256,
      proofBufferDeploymentPlanSha256: inputs.proofReceipt.sourceDeploymentPlanSha256,
      proofBufferSourceBridgeUpgradeReceiptRawSha256: inputs.proofReceipt.sourceDeploymentReceiptSha256,
      postHandoffAuthorityDeltaReceiptFile: path.basename(inputs.postHandoffAuthorityDelta.file),
      postHandoffAuthorityDeltaReceiptRawSha256: inputs.postHandoffAuthorityDelta.sha256,
      postHandoffAuthorityDeltaReceiptSha256: inputs.postHandoffAuthorityDelta.value.receiptSha256,
      postHandoffAuthorityDeltaCensusFile: path.basename(inputs.postHandoffAuthorityDelta.census.file),
      postHandoffAuthorityDeltaCensusRawSha256: inputs.postHandoffAuthorityDelta.census.sha256,
      postHandoffAuthorityDeltaProgramDataRawFile: path.basename(inputs.postHandoffAuthorityDelta.currentRaw.file),
      postHandoffAuthorityDeltaProgramDataRawSha256: inputs.postHandoffAuthorityDelta.currentRaw.sha256,
      postHandoffAuthorityDeltaContextSlot: inputs.postHandoffAuthorityDelta.value.current.contextSlot,
      postHandoffCompatibilityInventorySha256: sha256Hex(Buffer.from(sortedPrettyCanonicalJson(inputs.postHandoffAuthorityDelta.value.current.compatibilityInventory), "utf8")),
    },
    gate: {
      status: state.gate.status,
      epoch: state.gate.epoch.toString(),
      nextEpoch: (state.gate.epoch + 1n).toString(),
      freezeSlot: state.gate.freezeSlot.toString(),
      freezeReasonCode: state.gate.freezeReasonCode,
      activeProposal: state.gate.activeProposal.toBase58(),
    },
    governance: {
      targetNonce: state.config.targetNonce.toString(),
      councilVersion: state.council.version.toString(),
      councilHash: state.council.setHash.toString("hex"),
      policyVersion: state.policy.version.toString(),
      policyHash: state.policy.policyHash.toString("hex"),
      approvalSeats: SEATS.slice(0, 3).map((entry) => entry.toBase58()),
      approvalThreshold: 3,
      approvalSeatRunway: approvalRunway,
    },
    programdata: {
      deployedSlot: state.targetProgramdata.deployedSlot.toString(),
      rawBytes: state.targetProgramdata.raw.length,
      capacity: state.targetProgramdata.payload.length,
      payloadOffset: PROGRAMDATA_HEADER_LEN,
      authority: state.ids.authority.toBase58(),
      headerHex: state.targetProgramdata.header.toString("hex"),
      rawSha256: sha256Hex(state.targetProgramdata.raw),
      payloadSha256: sha256Hex(state.targetProgramdata.payload),
      zeroTailBytes: state.targetProgramdata.payload.length - inputs.artifact.length,
    },
    handoff: {
      proposal: state.ids.handoffProposal.toBase58(),
      proposalDigest: handoffProgress.proposal.proposalDigest.toString("hex"),
      receipt: state.ids.handoffReceipt.toBase58(),
      receiptDigest: handoffProgress.receipt.receiptDigest.toString("hex"),
      acceptedSlot: handoffProgress.receipt.acceptedSlot.toString(),
    },
    negative: {
      proofBuffer: inputs.proofBuffer.toBase58(),
      proofBufferRawSha256: inputs.proofReceipt.bufferRawSha256,
      proofBufferReceiptSha256: inputs.proofReceiptSha256,
      proofBufferLamports: recovery?.close.receipt.proofBufferLamports ?? proofAccount?.lamports,
      spillTreasuryLamportsBeforeClose: recovery?.close.receipt.treasuryLamportsBefore ?? treasuryAccount.lamports,
      expectedInstructionError: "IncorrectAuthority",
      expectedLog: "Incorrect authority provided",
      simulationRequired: true,
      submittedFailureRequired: true,
      noCapacityExtension: true,
      closeRequiredBeforeActivation: true,
      closeReceiptFile: PROOF_BUFFER_CLOSE_RECEIPT_FILE,
      closeInstructionDataHex: LOADER_CLOSE_DATA.toString("hex"),
      proofsSatisfiedBeforePlanning: recovery !== null,
      proofBufferClosedBeforePlanning: recovery !== null,
      recoverySourcePlanFile: recovery ? path.basename(recovery.source.file) : null,
      recoverySourcePlanOperationId: recovery?.source.plan.operationId ?? null,
      recoverySourcePlanRawSha256: recovery?.source.sha256 ?? null,
      recoveryNegativeProofRawSha256: recovery?.negativeSha256 ?? null,
      recoveryCloseReceiptRawSha256: recovery?.close.sha256 ?? null,
      recoveryCloseReceiptSha256: recovery?.close.receipt.receiptSha256 ?? null,
      recoveryCloseFinalizedSlot: recovery?.close.receipt.finalizedSlot ?? null,
    },
    observation: {
      purpose: ProgramDataObservationPurposeV1.BootstrapActivation,
      generation: ACTIVATION_OBSERVATION_GENERATION.toString(),
      subject: state.ids.handoffReceipt.toBase58(),
      subjectDigest: model.subjectDigest.toString("hex"),
      account: model.observation.toBase58(),
      bump: model.observationBump,
      expectedRawMerkleRoot: model.rawRoot.toString("hex"),
      expectedRawSha256: model.rawSha256.toString("hex"),
      rawSchemeId: PROGRAMDATA_OBSERVATION_MERKLE_SCHEME_ID_V1.toString("hex"),
      rawChunkSize: state.capacity.observationChunkSize,
      rawChunkCount: model.rawGeometry.chunkCount,
      rawPaddedLeafCount: model.rawGeometry.paddedChunkCount,
      rawTreeDepth: model.rawGeometry.treeDepth,
      expectedTailBytesVerified: model.tailBytes.toString(),
    },
    activation: {
      proposal: state.ids.activationProposal.toBase58(),
      proposalBump: state.ids.activationProposalBump,
      receipt: state.ids.activationReceipt.toBase58(),
      receiptBump: state.ids.activationReceiptBump,
      currentDeployment: state.ids.currentDeployment.toBase58(),
      currentDeploymentBump: state.ids.currentDeploymentBump,
      noLoaderCpi: true,
      targetNonceConsumed: false,
      expectedGateStatus: GateStatusV1.Active,
      expectedGateEpoch: (state.gate.epoch + 1n).toString(),
      simulationProbe: {
        businessInstruction: "UpdateConfig",
        businessDataHex: "020000000000",
        businessAccounts: 0,
        staleEpochExpectedCustomError: 6264,
        currentEpochExpectedCustomError: 6001,
        submissionAllowed: false,
      },
    },
    transactionBlueprints: {
      negative: {
        stage: "former-authority-negative",
        dynamicFields: [],
        ...normalizedPacket([negativeInstruction], [PAYER, LEGACY_AUTHORITY]),
      },
      close: {
        stage: "former-authority-proof-buffer-close",
        dynamicFields: [],
        ...normalizedPacket([closeInstruction], [PAYER, LEGACY_AUTHORITY]),
      },
      observation,
      create: {
        stage: "activation-create",
        dynamicFields: ["expectedBridgeObservationDigest"],
        ...normalizedPacket([create], [PAYER, SEATS[0]]),
      },
      approvals,
      queue: {
        stage: "activation-queue",
        dynamicFields: ["expectedProposalDigest"],
        ...normalizedPacket([queue], [PAYER]),
      },
      execute: {
        stage: "activation-execute",
        dynamicFields: [
          "expectedProposalDigest", "expectedBridgeObservationDigest",
          "expectedDeploymentPlanDigest", "expectedReceiptPlanDigest",
        ],
        ...normalizedPacket([...computePrefix(), execute], [PAYER]),
      },
      probes: {
        oldEpoch: {
          stage: "simulate-old-epoch",
          dynamicFields: [],
          ...normalizedPacket([
            harmlessGovernedSpreadProbe(state.gate.epoch, state.ids.gate),
          ], [PAYER]),
        },
        currentEpoch: {
          stage: "simulate-current-epoch",
          dynamicFields: [],
          ...normalizedPacket([
            harmlessGovernedSpreadProbe(state.gate.epoch + 1n, state.ids.gate),
          ], [PAYER]),
        },
      },
    },
    toolSha256,
  };
}

function buildPlanMaterial(inputs, state, model, rpcConfiguration, toolSha256) {
  const accounts = handoffAccounts(state, model);
  assert(state.handoffProofBufferAccount, "handoff planning did not read the former-authority proof buffer");
  parseBufferAccount(state.handoffProofBufferAccount, inputs, "handoff prerequisite proof buffer");
  const planValidUntilSlot = BigInt(state.slot) + BigInt(PLAN_TTL_SLOTS);
  assert.equal(inputs.evidence.manifest.controllerConfig, state.ids.config.toBase58(), "release manifest config changed");
  assert.equal(inputs.evidence.manifest.protocolGate, state.ids.gate.toBase58(), "release manifest gate changed");
  assert.equal(inputs.evidence.manifest.controllerAuthority, state.ids.authority.toBase58(), "release manifest controller authority changed");
  const create = buildCreateTargetAuthorityHandoffV1Instruction(CONTROLLER, accounts.create, {
    expectedGateEpoch: state.gate.epoch,
    expectedTargetNonce: state.config.targetNonce,
    expectedCouncilVersion: state.council.version,
    bridgeSourceCommitment: Buffer.from(inputs.evidence.source.sha256, "hex"),
    bridgeBuildInputsCommitment: Buffer.from(inputs.evidence.buildInputs.sha256, "hex"),
    bridgePackageCommitment: Buffer.from(inputs.evidence.packageReceipt.sha256, "hex"),
    bridgeReleaseManifestCommitment: Buffer.from(inputs.evidence.releaseManifest.sha256, "hex"),
    planValidUntilSlot,
  });
  const placeholderDigest = hashBytes(Buffer.from("AMOEBA_HANDOFF_PROPOSAL_DIGEST_PLACEHOLDER_V1", "ascii"));
  const approvalValue = {
    expectedProposalDigest: placeholderDigest,
    expectedCouncilVersion: state.council.version,
    expectedGateEpoch: state.gate.epoch,
    expectedTargetNonce: state.config.targetNonce,
  };
  const approveBlueprints = SEATS.slice(0, 3).map((seatAuthority, index) => {
    const instruction = buildApproveTargetAuthorityHandoffV1Instruction(CONTROLLER, {
      ...accounts.common,
      seatAuthority,
    }, approvalValue);
    return {
      stage: `handoff-approve-${index}`,
      dynamicFields: ["expectedProposalDigest"],
      ...normalizedPacket([instruction], [PAYER, seatAuthority]),
    };
  });
  const queue = buildQueueTargetAuthorityHandoffV1Instruction(CONTROLLER, accounts.common, approvalValue);
  const accept = buildAcceptTargetAuthorityCheckedV1Instruction(CONTROLLER, accounts.accept, {
    expectedProposalDigest: placeholderDigest,
    expectedBridgeObservationDigest: model.rawRoot,
    expectedGateEpoch: state.gate.epoch,
    expectedTargetNonce: state.config.targetNonce,
    envelope: envelope(),
  });
  const observation = observationInstructions(model).map((entry) => ({
    stage: entry.stage,
    dynamicFields: [],
    ...normalizedPacket(entry.instructions, entry.signers),
  }));
  const approvalRunway = approvalSeatRunway(state, 2, observation.length * 2, "handoff and bootstrap activation");
  const preRaw = state.targetProgramdata.raw;
  const postRaw = postHandoffRaw(preRaw, state.ids.authority);
  return {
    schema: PLAN_SCHEMA,
    mainnetAllowed: false,
    cluster: {
      genesisHash: EXPECTED_GENESIS,
      clusterDomainHex: state.config.clusterDomain.toString("hex"),
      commitment: "finalized",
    },
    rpc: {
      selection: rpcConfiguration.rpcSelection,
      providerOriginSha256: originCommitment(rpcConfiguration.stateRpcOrigin),
    },
    plannedAtSlot: state.slot,
    planValidUntilSlot: planValidUntilSlot.toString(),
    identities: {
      controllerProgram: CONTROLLER.toBase58(),
      controllerProgramdata: CONTROLLER_PROGRAMDATA.toBase58(),
      controllerConfig: state.ids.config.toBase58(),
      controllerAuthority: state.ids.authority.toBase58(),
      governancePolicy: state.ids.policy.toBase58(),
      governanceCouncil: state.ids.council.toBase58(),
      protocolGate: state.ids.gate.toBase58(),
      capacityPolicy: state.ids.capacityPolicy.toBase58(),
      controllerImmutabilityReceipt: state.ids.immutabilityReceipt.toBase58(),
      targetProgram: TARGET.toBase58(),
      targetProgramdata: TARGET_PROGRAMDATA.toBase58(),
      legacyAuthority: LEGACY_AUTHORITY.toBase58(),
      handoffProposal: state.ids.handoffProposal.toBase58(),
      handoffReceipt: state.ids.handoffReceipt.toBase58(),
      payer: PAYER.toBase58(),
      seats: SEATS.map((entry) => entry.toBase58()),
      upgradeableLoader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58(),
    },
    baseAccountFingerprints: state.baseFingerprints,
    artifact: {
      bytes: inputs.artifact.length,
      sha256: inputs.artifactSha256,
      merkleRoot: inputs.artifactMerkle.toString("hex"),
      schemeId: ARTIFACT_MERKLE_SCHEME_ID.toString("hex"),
      chunkSize: RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
      chunkCount: model.artifactChunks,
    },
    evidence: evidencePlan(inputs),
    gate: {
      status: state.gate.status,
      epoch: state.gate.epoch.toString(),
      freezeSlot: state.gate.freezeSlot.toString(),
      freezeReasonCode: state.gate.freezeReasonCode,
      activeProposal: state.gate.activeProposal.toBase58(),
    },
    governance: {
      targetNonce: state.config.targetNonce.toString(),
      councilVersion: state.council.version.toString(),
      councilHash: state.council.setHash.toString("hex"),
      policyVersion: state.policy.version.toString(),
      policyHash: state.policy.policyHash.toString("hex"),
      majorDelaySlots: state.config.majorDelaySlots.toString(),
      reviewSlots: state.config.voteReviewSlots.toString(),
      proposalExpirySlots: state.config.proposalExpirySlots.toString(),
      approvalSeats: SEATS.slice(0, 3).map((entry) => entry.toBase58()),
      approvalThreshold: 3,
      approvalSeatRunway: approvalRunway,
    },
    programdata: {
      deployedSlot: state.targetProgramdata.deployedSlot.toString(),
      rawBytes: preRaw.length,
      capacity: state.targetProgramdata.payload.length,
      payloadOffset: PROGRAMDATA_HEADER_LEN,
      preAuthority: LEGACY_AUTHORITY.toBase58(),
      postAuthority: state.ids.authority.toBase58(),
      preHeaderHex: state.targetProgramdata.header.toString("hex"),
      postHeaderHex: postRaw.subarray(0, PROGRAMDATA_HEADER_LEN).toString("hex"),
      preRawSha256: sha256Hex(preRaw),
      postRawSha256: sha256Hex(postRaw),
      payloadSha256: sha256Hex(state.targetProgramdata.payload),
      zeroTailBytes: state.targetProgramdata.payload.length - inputs.artifact.length,
    },
    observation: {
      purpose: ProgramDataObservationPurposeV1.TargetHandoffBridge,
      generation: OBSERVATION_GENERATION.toString(),
      subject: state.ids.immutabilityReceipt.toBase58(),
      subjectDigest: model.subjectDigest.toString("hex"),
      account: model.observation.toBase58(),
      bump: model.observationBump,
      expectedRawMerkleRoot: model.rawRoot.toString("hex"),
      expectedRawSha256: model.rawSha256.toString("hex"),
      rawSchemeId: PROGRAMDATA_OBSERVATION_MERKLE_SCHEME_ID_V1.toString("hex"),
      rawChunkSize: state.capacity.observationChunkSize,
      rawChunkCount: model.rawGeometry.chunkCount,
      rawPaddedLeafCount: model.rawGeometry.paddedChunkCount,
      rawTreeDepth: model.rawGeometry.treeDepth,
      expectedTailBytesVerified: model.tailBytes.toString(),
    },
    handoff: {
      proposal: state.ids.handoffProposal.toBase58(),
      proposalBump: state.ids.handoffProposalBump,
      receipt: state.ids.handoffReceipt.toBase58(),
      receiptBump: state.ids.handoffReceiptBump,
      formerAuthorityProofBuffer: inputs.bridgeEvidence.proofBuffer.toBase58(),
      formerAuthorityProofBufferRawSha256: inputs.bridgeEvidence.wrapper.value.formerAuthorityProofBufferRawSha256,
      formerAuthorityProofBufferFingerprint: accountFingerprint(state.handoffProofBufferAccount),
      formerAuthorityProofBufferRequiredThroughAcceptance: true,
      loaderOperation: "SetAuthorityChecked",
      loaderInstructionDataHex: "07000000",
      continuousFreezeRequired: true,
      targetNonceConsumed: false,
    },
    transactionBlueprints: {
      observation,
      create: {
        stage: "handoff-create",
        dynamicFields: [],
        ...normalizedPacket([create], [PAYER, SEATS[0]]),
      },
      approvals: approveBlueprints,
      queue: {
        stage: "handoff-queue",
        dynamicFields: ["expectedProposalDigest"],
        ...normalizedPacket([queue], [PAYER]),
      },
      accept: {
        stage: "handoff-accept",
        dynamicFields: ["expectedProposalDigest", "expectedBridgeObservationDigest"],
        ...normalizedPacket([...computePrefix(), accept], [PAYER, LEGACY_AUTHORITY]),
      },
    },
    toolSha256,
  };
}

async function writeJsonOnce(file, value) {
  try {
    const existing = JSON.parse(await readFile(file, "utf8"));
    assert.deepEqual(existing, value, `${path.basename(file)} already exists with different content`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await writeExclusiveJson(file, value);
  }
}

async function planHandoff() {
  const inputs = await readInputs();
  const toolSha256 = sha256Hex(await readFile(fileURLToPath(import.meta.url)));
  const planningId = operationId({
    schema: "ameba-governance-devnet-spread-handoff-planning-v2",
    artifactSha256: inputs.artifactSha256,
    releaseManifestSha256: inputs.evidence.releaseManifest.sha256,
    bridgeUpgradeReceiptRawSha256: inputs.bridgeEvidence.wrapper.sha256,
    poststateRepeatReceiptRawSha256: inputs.bridgeEvidence.repeatReceipt.sha256,
  });
  await withCeremonyRpcOwnerLock(inputs.runDir, planningId, async () => {
    const journal = await openJournal(inputs.runDir, PLANNING_JOURNAL_NAME, planningId);
    try {
      const rawConnection = new Connection(inputs.rpcConfiguration.stateRpcUrl, FINALIZED_CONNECTION_CONFIG);
      const connection = guardRpcConnection(rawConnection, journal, "spread-handoff-plan");
      const genesis = await connection.getGenesisHash();
      assert.equal(genesis, EXPECTED_GENESIS, "state RPC genesis changed");
      const state = await readBaseState(connection, inputs);
      assert(state.targetProgramdata.authority?.equals(LEGACY_AUTHORITY), "Spread target is not controlled by the legacy authority before handoff planning");
      const bridgeEvidenceSlot = inputs.bridgeEvidence.repeatReceipt.value.historyExclusion.throughInclusiveSlot;
      const proofBufferRead = await connection.getAccountInfoAndContext(
        inputs.bridgeEvidence.proofBuffer,
        finalizedConfig(Math.max(state.slot, bridgeEvidenceSlot)),
      );
      assert(
        proofBufferRead.context.slot >= Math.max(state.slot, bridgeEvidenceSlot),
        "handoff proof-buffer read predates its bridge evidence",
      );
      parseBufferAccount(proofBufferRead.value, inputs, "handoff prerequisite proof buffer");
      state.handoffProofBufferAccount = proofBufferRead.value;
      state.slot = proofBufferRead.context.slot;
      inputs.frozenGateCensus = await ensureFrozenGateCensus(connection, journal, inputs, state);
      state.slot = Math.max(state.slot, inputs.frozenGateCensus.receipt.observedSlotAfter);
      const model = observationModel(inputs, state);
      const progress = await connection.getMultipleAccountsInfoAndContext(
        [model.observation, state.ids.handoffProposal, state.ids.handoffReceipt],
        finalizedConfig(state.slot),
      );
      assert(progress.context.slot >= state.slot, "handoff progress read predates base state");
      assertVacant(progress.value[0], "handoff observation");
      assertVacant(progress.value[1], "handoff proposal");
      assertVacant(progress.value[2], "handoff receipt");
      const material = buildPlanMaterial(inputs, { ...state, slot: progress.context.slot }, model, inputs.rpcConfiguration, toolSha256);
      const plan = { ...material, operationId: operationId(material) };
      const ordered = { schema: plan.schema, operationId: plan.operationId, ...Object.fromEntries(Object.entries(plan).filter(([key]) => !["schema", "operationId"].includes(key))) };
      assertExactKeys(ordered, PLAN_KEYS, "Spread handoff plan");
      await writeJsonOnce(fileInRunDir(inputs.runDir, PLAN_FILE), ordered);
      await journal.append("plan-written", {
        planOperationId: ordered.operationId,
        planSha256: sha256Hex(Buffer.from(JSON.stringify(ordered), "utf8")),
        observedSlot: progress.context.slot,
      });
      process.stdout.write(`${JSON.stringify({
        schema: ordered.schema,
        operationId: ordered.operationId,
        observedSlot: ordered.plannedAtSlot,
        planValidUntilSlot: ordered.planValidUntilSlot,
        observationTransactions: ordered.transactionBlueprints.observation.length,
        requiredArm: `execute-handoff:${ordered.operationId}`,
        planFile: fileInRunDir(inputs.runDir, PLAN_FILE),
      }, null, 2)}\n`);
    } finally {
      await journal.close();
    }
  });
}

async function loadPlan(inputs) {
  const file = await requireSecureRegularFile(fileInRunDir(inputs.runDir, PLAN_FILE), "Spread handoff plan");
  const plan = JSON.parse(await readFile(file, "utf8"));
  assertExactKeys(plan, PLAN_KEYS, "Spread handoff plan");
  assert.equal(plan.schema, PLAN_SCHEMA, "Spread handoff plan schema changed");
  const { operationId: storedOperationId, ...material } = plan;
  assert.equal(operationId(material), storedOperationId, "Spread handoff plan operation ID changed");
  assert.equal(plan.mainnetAllowed, false, "Spread handoff plan unexpectedly allows Mainnet");
  assert.equal(plan.toolSha256, sha256Hex(await readFile(fileURLToPath(import.meta.url))), "Spread handoff tool changed after planning");
  return plan;
}

function assertPlanInputs(plan, inputs, rpcConfiguration) {
  assert.equal(plan.cluster.genesisHash, EXPECTED_GENESIS, "plan genesis changed");
  assert.equal(plan.cluster.commitment, "finalized", "plan commitment changed");
  assert.equal(plan.rpc.selection, rpcConfiguration.rpcSelection, "RPC selection changed since planning");
  assert.equal(plan.rpc.providerOriginSha256, originCommitment(rpcConfiguration.stateRpcOrigin), "RPC provider origin changed since planning");
  assert.equal(plan.artifact.bytes, inputs.artifact.length, "bridge artifact length changed since planning");
  assert.equal(plan.artifact.sha256, inputs.artifactSha256, "bridge artifact SHA-256 changed since planning");
  assert.equal(plan.artifact.merkleRoot, inputs.artifactMerkle.toString("hex"), "bridge artifact Merkle root changed since planning");
  assert.deepEqual(plan.evidence, evidencePlan(inputs), "bridge evidence files changed since planning");
  assert.equal(plan.identities.controllerProgram, CONTROLLER.toBase58());
  assert.equal(plan.identities.controllerProgramdata, CONTROLLER_PROGRAMDATA.toBase58());
  assert.equal(plan.identities.targetProgram, TARGET.toBase58());
  assert.equal(plan.identities.targetProgramdata, TARGET_PROGRAMDATA.toBase58());
  assert.equal(plan.identities.legacyAuthority, LEGACY_AUTHORITY.toBase58());
  assert.equal(plan.identities.payer, PAYER.toBase58());
  assert.deepEqual(plan.identities.seats, SEATS.map((entry) => entry.toBase58()));
}

function assertHandoffLocalReceipt(inputs, plan, validated) {
  const receipt = inputs.handoffLocalReceipt;
  assert.equal(receipt.operationId, plan.operationId, "handoff receipt operation changed");
  assert.equal(receipt.planSha256, sha256Hex(Buffer.from(JSON.stringify(plan), "utf8")), "handoff receipt plan hash changed");
  assert.equal(receipt.controllerConfig, plan.identities.controllerConfig);
  assert.equal(receipt.controllerAuthority, plan.identities.controllerAuthority);
  assert.equal(receipt.observation, plan.observation.account);
  assert.equal(receipt.proposal, plan.handoff.proposal);
  assert.equal(receipt.handoffReceipt, plan.handoff.receipt);
  assert.equal(receipt.authorityBefore, LEGACY_AUTHORITY.toBase58());
  assert.equal(receipt.authorityAfter, plan.identities.controllerAuthority);
  assert.equal(receipt.programdataPreRawSha256, plan.programdata.preRawSha256);
  assert.equal(receipt.programdataPostRawSha256, plan.programdata.postRawSha256);
  assert.equal(receipt.gateEpoch, plan.gate.epoch);
  assert.equal(receipt.targetNonce, plan.governance.targetNonce);
  assert.equal(receipt.controllerRemainedImmutable, true);
  assert.equal(receipt.targetNonceConsumed, false);
  assert.equal(receipt.gateChanged, false);
  assert.equal(receipt.formerAuthorityNegativeTestCompleted, false);
  assert.equal(receipt.bootstrapActivationCompleted, false);
  assert(validated.progress.observation && validated.progress.proposal && validated.progress.receipt, "handoff receipt lacks finalized on-chain graph");
  assert.equal(receipt.observationDigest, validated.progress.observation.observationDigest.toString("hex"));
  assert.equal(receipt.observationRoot, validated.progress.observation.finalRawMerkleRoot.toString("hex"));
  assert.equal(receipt.proposalDigest, validated.progress.proposal.proposalDigest.toString("hex"));
  assert.equal(receipt.handoffReceiptDigest, validated.progress.receipt.receiptDigest.toString("hex"));
  assert.equal(receipt.acceptedSlot, validated.progress.receipt.acceptedSlot.toString());
  assert.equal(receipt.accountRawSha256.observation, sha256Hex(validated.progress.accounts[0].data));
  assert.equal(receipt.accountRawSha256.proposal, sha256Hex(validated.progress.accounts[1].data));
  assert.equal(receipt.accountRawSha256.receipt, sha256Hex(validated.progress.accounts[2].data));
  assert.equal(receipt.accountRawSha256.targetProgramdata, sha256Hex(validated.state.targetProgramdata.raw));
  const expectedStages = [
    ...plan.transactionBlueprints.observation.map((entry) => entry.stage),
    plan.transactionBlueprints.create.stage,
    ...plan.transactionBlueprints.approvals.map((entry) => entry.stage),
    plan.transactionBlueprints.queue.stage,
    plan.transactionBlueprints.accept.stage,
  ];
  assert.deepEqual(receipt.finalizedTransactions.map((entry) => entry.stage), expectedStages, "handoff receipt transaction sequence changed");
}

async function assertHandoffJournalAnchors(inputs, plan) {
  await requireSecureRegularFile(fileInRunDir(inputs.runDir, `${JOURNAL_NAME}.jsonl`), "Spread handoff journal");
  const journal = await openJournal(inputs.runDir, JOURNAL_NAME, plan.operationId);
  try {
    for (const transaction of inputs.handoffLocalReceipt.finalizedTransactions) {
      const entry = journal.entries.find((candidate) => candidate.entrySha256 === transaction.entrySha256);
      assert(entry, `handoff receipt stage ${transaction.stage} is not anchored in its hash-chained journal`);
      assert(["finalized", "reconciled-finalized"].includes(entry.event), `handoff receipt stage ${transaction.stage} has the wrong journal event`);
      assert.equal(entry.stage, transaction.stage, `handoff receipt stage ${transaction.stage} journal stage changed`);
      assert.equal(entry.signature, transaction.signature, `handoff receipt stage ${transaction.stage} journal signature changed`);
      assert.equal(entry.slot, transaction.slot, `handoff receipt stage ${transaction.stage} journal slot changed`);
    }
  } finally {
    await journal.close();
  }
}

async function planActivation() {
  const inputs = await readActivationInputs();
  assert.equal(inputs.postActivationAuthorityDelta, null, "post-activation authority-delta evidence exists before activation planning");
  const handoffPlan = await loadPlan(inputs);
  assertPlanInputs(handoffPlan, inputs, inputs.rpcConfiguration);
  const recovery = await loadActivationRecoverySource(inputs);
  const toolSha256 = sha256Hex(await readFile(fileURLToPath(import.meta.url)));
  const planningId = operationId({
    schema: "ameba-governance-devnet-bootstrap-activation-planning-v3",
    handoffOperationId: handoffPlan.operationId,
    proofBufferReceiptSha256: inputs.proofReceiptSha256,
    poststateRepeatReceiptRawSha256: inputs.bridgeEvidence.repeatReceipt.sha256,
    recoverySourcePlanRawSha256: recovery?.source.sha256 ?? null,
    recoveryNegativeProofRawSha256: recovery?.negativeSha256 ?? null,
    recoveryCloseReceiptRawSha256: recovery?.close.sha256 ?? null,
  });
  await withCeremonyRpcOwnerLock(inputs.runDir, planningId, async () => {
    const journal = await openJournal(inputs.runDir, activationPlanningJournalName(planningId), planningId);
    try {
      const rawConnection = new Connection(inputs.rpcConfiguration.stateRpcUrl, FINALIZED_CONNECTION_CONFIG);
      const connection = guardRpcConnection(rawConnection, journal, "bootstrap-activation-plan");
      assert.equal(await connection.getGenesisHash(), EXPECTED_GENESIS, "state RPC genesis changed");
      const handoff = await validatedLiveState(connection, inputs, handoffPlan);
      const handoffAction = nextAction(handoff, inputs, handoffPlan);
      assert.equal(handoffAction.done, true, "checked target-authority handoff is not complete");
      assert(handoff.progress.receipt && handoff.progress.proposal, "checked handoff evidence is incomplete");
      assert(
        inputs.postHandoffAuthorityDelta.value.current.contextSlot >= Number(handoff.progress.receipt.acceptedSlot),
        "post-handoff authority-delta census predates the finalized handoff",
      );
      assertHandoffLocalReceipt(inputs, handoffPlan, handoff);
      await assertHandoffJournalAnchors(inputs, handoffPlan);
      assert(handoff.state.targetProgramdata.authority?.equals(handoff.state.ids.authority), "target authority is not the controller PDA");
      let model = activationObservationModel(inputs, handoff.state);
      const addresses = [
        inputs.proofBuffer,
        TREASURY,
        model.observation,
        handoff.state.ids.activationProposal,
        handoff.state.ids.activationReceipt,
        handoff.state.ids.currentDeployment,
      ];
      const response = await connection.getMultipleAccountsInfoAndContext(addresses, finalizedConfig(handoff.state.slot));
      assert(response.context.slot >= handoff.state.slot, "activation planning read predates the handoff state");
      assert(response.context.slot >= inputs.proofReceipt.finalizedSlot, "proof-buffer account read predates its preservation receipt");
      const [proofAccount, treasuryAccount, observationAccount, proposalAccount, receiptAccount, deploymentAccount] = response.value;
      if (proofAccount) {
        assert.equal(recovery, null, "activation recovery source was supplied while the proof buffer is still live");
        parseBufferAccount(proofAccount, inputs);
      } else {
        assert(recovery, "proof buffer is already closed; set AMEBA_BOOTSTRAP_ACTIVATION_SOURCE_PLAN to the exact prior plan before replanning");
        const sourceJournal = await openJournal(
          inputs.runDir,
          activationJournalName(recovery.source.plan.operationId),
          recovery.source.plan.operationId,
        );
        try {
          const recoveryClose = { ...recovery.close, replanning: true };
          const recovered = await readActivationLiveState(
            connection,
            inputs,
            recovery.source.plan,
            Math.max(response.context.slot, recovery.close.receipt.finalizedSlot),
            recoveryClose,
          );
          await verifyNegativeProofLive(connection, sourceJournal, inputs, recovery.source.plan, recovery.negative, recovered);
          await verifyProofBufferCloseReceiptLive(
            connection,
            sourceJournal,
            inputs,
            recovery.source.plan,
            recovery.negative,
            recovery.close,
            recovered,
          );
          assert.equal(recovered.state.gate.status, GateStatusV1.EmergencyFrozen, "activation recovery is not continuously frozen");
          assert.equal(recovered.progress.proposal, null, "activation recovery source already created its proposal");
          handoff.state = recovered.state;
        } finally {
          await sourceJournal.close();
        }
      }
      assert(treasuryAccount, "canonical spill treasury is absent");
      assertVacant(observationAccount, "activation observation");
      assertVacant(proposalAccount, "activation proposal");
      assertVacant(receiptAccount, "activation receipt");
      assertVacant(deploymentAccount, "current deployment state");
      handoff.state.slot = Math.max(handoff.state.slot, response.context.slot);
      model = activationObservationModel(inputs, handoff.state);
      const material = buildActivationPlanMaterial(
        inputs,
        handoff.state,
        handoffPlan,
        handoff.progress,
        model,
        proofAccount,
        treasuryAccount,
        inputs.rpcConfiguration,
        toolSha256,
        recovery,
      );
      const plan = { ...material, operationId: operationId(material) };
      const ordered = {
        schema: plan.schema,
        operationId: plan.operationId,
        ...Object.fromEntries(Object.entries(plan).filter(([key]) => !["schema", "operationId"].includes(key))),
      };
      assertExactKeys(ordered, ACTIVATION_PLAN_KEYS, "bootstrap activation plan");
      const planBasename = recovery
        ? `spread-bootstrap-activation-replan-v1-${ordered.operationId}.json`
        : ACTIVATION_PLAN_FILE;
      const planFile = fileInRunDir(inputs.runDir, planBasename);
      await writeJsonOnce(planFile, ordered);
      await journal.append("plan-written", {
        planOperationId: ordered.operationId,
        planSha256: sha256Hex(Buffer.from(JSON.stringify(ordered), "utf8")),
        observedSlot: response.context.slot,
        proofBuffer: inputs.proofBuffer.toBase58(),
      });
      process.stdout.write(`${JSON.stringify({
        schema: ordered.schema,
        operationId: ordered.operationId,
        observedSlot: ordered.plannedAtSlot,
        planValidUntilSlot: ordered.planValidUntilSlot,
        negativeProofRequired: recovery === null,
        proofBufferCloseRequired: recovery === null,
        recoveredProofBufferClose: recovery !== null,
        observationTransactions: ordered.transactionBlueprints.observation.length,
        requiredArm: `execute-activation:${ordered.operationId}`,
        planFile,
        requiredPlanEnvironment: `AMEBA_BOOTSTRAP_ACTIVATION_PLAN=${planFile}`,
      }, null, 2)}\n`);
    } finally {
      await journal.close();
    }
  });
}

async function loadActivationPlanFile(inputs, requestedFile, label = "bootstrap activation plan") {
  const basename = path.basename(requestedFile);
  assert(
    basename === ACTIVATION_PLAN_FILE || ACTIVATION_REPLAN_PATTERN.test(basename),
    `${label} basename is not canonical`,
  );
  assert.equal(path.resolve(requestedFile), fileInRunDir(inputs.runDir, basename), `${label} is outside the ceremony run directory`);
  const file = await requireSecureRegularFile(requestedFile, label);
  const plan = JSON.parse(await readFile(file, "utf8"));
  assertExactKeys(plan, ACTIVATION_PLAN_KEYS, label);
  assert.equal(plan.schema, ACTIVATION_PLAN_SCHEMA, `${label} schema changed`);
  const { operationId: storedOperationId, ...material } = plan;
  assert.equal(operationId(material), storedOperationId, `${label} operation ID changed`);
  const replanMatch = ACTIVATION_REPLAN_PATTERN.exec(basename);
  if (replanMatch) assert.equal(replanMatch[1], storedOperationId, `${label} filename operation ID changed`);
  assert.equal(plan.mainnetAllowed, false, `${label} unexpectedly allows Mainnet`);
  assert.equal(plan.toolSha256, sha256Hex(await readFile(fileURLToPath(import.meta.url))), `${label} tool changed after planning`);
  assert.equal(plan.cluster.genesisHash, EXPECTED_GENESIS, "activation plan genesis changed");
  assert.equal(plan.cluster.commitment, "finalized", "activation plan commitment changed");
  assert.equal(plan.rpc.selection, inputs.rpcConfiguration.rpcSelection, "activation RPC selection changed since planning");
  assert.equal(plan.rpc.providerOriginSha256, originCommitment(inputs.rpcConfiguration.stateRpcOrigin), "activation RPC provider origin changed since planning");
  assert.equal(plan.artifact.bytes, inputs.artifact.length, "activation artifact length changed since planning");
  assert.equal(plan.artifact.sha256, inputs.artifactSha256, "activation artifact SHA-256 changed since planning");
  assert.equal(plan.artifact.merkleRoot, inputs.artifactMerkle.toString("hex"), "activation artifact Merkle root changed since planning");
  assert.equal(plan.identities.proofBuffer, inputs.proofBuffer.toBase58(), "activation proof buffer changed since planning");
  const expectedBaseEvidence = evidencePlan(inputs);
  assertExactKeys(plan.evidence, [
    ...Object.keys(expectedBaseEvidence), "handoffPlanOperationId", "handoffLocalReceiptSha256",
    "handoffReceiptAccountSha256", "proofBufferReceiptSha256",
    "proofBufferDeploymentPlanSha256", "proofBufferSourceBridgeUpgradeReceiptRawSha256",
    "postHandoffAuthorityDeltaReceiptFile", "postHandoffAuthorityDeltaReceiptRawSha256",
    "postHandoffAuthorityDeltaReceiptSha256", "postHandoffAuthorityDeltaCensusFile",
    "postHandoffAuthorityDeltaCensusRawSha256", "postHandoffAuthorityDeltaProgramDataRawFile",
    "postHandoffAuthorityDeltaProgramDataRawSha256", "postHandoffAuthorityDeltaContextSlot",
    "postHandoffCompatibilityInventorySha256",
  ], "activation bridge evidence");
  for (const [field, expected] of Object.entries(expectedBaseEvidence)) {
    assert.deepEqual(plan.evidence[field], expected, `activation bridge evidence ${field} changed since planning`);
  }
  assert.equal(plan.evidence.handoffPlanOperationId, inputs.handoffLocalReceipt.operationId, "activation handoff operation changed since planning");
  assert.equal(plan.negative.proofBufferReceiptSha256, inputs.proofReceiptSha256, "proof-buffer receipt changed since planning");
  assert.equal(plan.negative.proofBufferRawSha256, inputs.proofReceipt.bufferRawSha256, "proof-buffer raw hash changed since planning");
  assert(Number.isSafeInteger(plan.negative.proofBufferLamports) && plan.negative.proofBufferLamports > 0, "planned proof-buffer lamports are invalid");
  assert(Number.isSafeInteger(plan.negative.spillTreasuryLamportsBeforeClose) && plan.negative.spillTreasuryLamportsBeforeClose >= 0, "planned spill-treasury lamports are invalid");
  assert.equal(plan.negative.closeRequiredBeforeActivation, true, "activation plan does not require proof-buffer closure");
  assert.equal(plan.negative.closeReceiptFile, PROOF_BUFFER_CLOSE_RECEIPT_FILE, "activation plan close-receipt filename changed");
  assert.equal(plan.negative.closeInstructionDataHex, LOADER_CLOSE_DATA.toString("hex"), "activation plan Loader Close data changed");
  assert.equal(plan.negative.proofsSatisfiedBeforePlanning, plan.negative.proofBufferClosedBeforePlanning, "activation proof-recovery flags differ");
  if (plan.negative.proofBufferClosedBeforePlanning) {
    assert.equal(plan.baseAccountFingerprints.proofBuffer, null, "replanned activation still binds a live proof buffer");
    assert.equal(typeof plan.negative.recoverySourcePlanFile, "string", "activation recovery source plan is absent");
    assert(
      plan.negative.recoverySourcePlanFile === ACTIVATION_PLAN_FILE
        || ACTIVATION_REPLAN_PATTERN.test(plan.negative.recoverySourcePlanFile),
      "activation recovery source-plan basename is not canonical",
    );
    for (const field of [
      "recoverySourcePlanOperationId", "recoverySourcePlanRawSha256",
      "recoveryNegativeProofRawSha256", "recoveryCloseReceiptRawSha256",
      "recoveryCloseReceiptSha256",
    ]) assertLowerHash(plan.negative[field], `activation ${field}`);
    assertSafeInteger(plan.negative.recoveryCloseFinalizedSlot, "activation recovery close slot", 1);
  } else {
    assert(plan.baseAccountFingerprints.proofBuffer, "initial activation plan does not bind the live proof buffer");
    for (const field of [
      "recoverySourcePlanFile", "recoverySourcePlanOperationId", "recoverySourcePlanRawSha256",
      "recoveryNegativeProofRawSha256", "recoveryCloseReceiptRawSha256",
      "recoveryCloseReceiptSha256", "recoveryCloseFinalizedSlot",
    ]) assert.equal(plan.negative[field], null, `initial activation plan unexpectedly contains ${field}`);
  }
  assert.equal(plan.transactionBlueprints.close.stage, "former-authority-proof-buffer-close", "activation plan close stage changed");
  assert.equal(plan.evidence.handoffLocalReceiptSha256, inputs.handoffLocalReceiptSha256, "handoff receipt file changed since activation planning");
  assert.equal(plan.evidence.proofBufferDeploymentPlanSha256, inputs.proofReceipt.sourceDeploymentPlanSha256, "bridge deployment plan changed since activation planning");
  assert.equal(plan.evidence.proofBufferSourceBridgeUpgradeReceiptRawSha256, inputs.proofReceipt.sourceDeploymentReceiptSha256, "proof-buffer source bridge upgrade receipt changed since activation planning");
  assert.equal(plan.evidence.postHandoffAuthorityDeltaReceiptFile, path.basename(inputs.postHandoffAuthorityDelta.file), "post-handoff authority-delta receipt filename changed");
  assert.equal(plan.evidence.postHandoffAuthorityDeltaReceiptRawSha256, inputs.postHandoffAuthorityDelta.sha256, "post-handoff authority-delta receipt bytes changed");
  assert.equal(plan.evidence.postHandoffAuthorityDeltaReceiptSha256, inputs.postHandoffAuthorityDelta.value.receiptSha256, "post-handoff authority-delta receipt digest changed");
  assert.equal(plan.evidence.postHandoffAuthorityDeltaCensusRawSha256, inputs.postHandoffAuthorityDelta.census.sha256, "post-handoff authority-delta census changed");
  assert.equal(plan.evidence.postHandoffAuthorityDeltaProgramDataRawSha256, inputs.postHandoffAuthorityDelta.currentRaw.sha256, "post-handoff authority-delta ProgramData changed");
  assert.deepEqual(plan.identities.seats, SEATS.map((entry) => entry.toBase58()), "activation council identities changed");
  return { plan, file, sha256: sha256Hex(await readFile(file)) };
}

async function loadActivationPlan(inputs) {
  const configured = process.env.AMEBA_BOOTSTRAP_ACTIVATION_PLAN?.trim();
  const requested = configured ?? fileInRunDir(inputs.runDir, ACTIVATION_PLAN_FILE);
  return (await loadActivationPlanFile(inputs, requested)).plan;
}

async function loadActivationRecoverySource(inputs) {
  const configured = process.env.AMEBA_BOOTSTRAP_ACTIVATION_SOURCE_PLAN?.trim();
  if (!configured) return null;
  const source = await loadActivationPlanFile(inputs, configured, "activation recovery source plan");
  assert.equal(source.plan.negative.proofBufferClosedBeforePlanning, false, "activation recovery source plan was itself created after buffer closure");
  const negative = await loadNegativeProof(inputs, source.plan);
  assert(negative, "activation recovery source lacks the finalized former-authority negative proof");
  const close = await loadProofBufferCloseReceipt(inputs, source.plan, negative);
  assert(close, "activation recovery source lacks the finalized proof-buffer Close receipt");
  const negativeFile = await requireSecureRegularFile(fileInRunDir(inputs.runDir, NEGATIVE_PROOF_FILE), "former-authority negative proof");
  return {
    source,
    negative,
    negativeSha256: sha256Hex(await readFile(negativeFile)),
    close,
  };
}

function assertActivationRecoveryBindings(plan, recovery) {
  if (!plan.negative.proofBufferClosedBeforePlanning) {
    assert.equal(recovery, null, "initial activation plan unexpectedly selected recovery evidence");
    return;
  }
  assert(recovery, "replanned activation requires its immutable recovery source plan");
  assert.equal(plan.negative.recoverySourcePlanFile, path.basename(recovery.source.file), "activation recovery source-plan file changed");
  assert.equal(plan.negative.recoverySourcePlanOperationId, recovery.source.plan.operationId, "activation recovery source operation changed");
  assert.equal(plan.negative.recoverySourcePlanRawSha256, recovery.source.sha256, "activation recovery source plan bytes changed");
  assert.equal(plan.negative.recoveryNegativeProofRawSha256, recovery.negativeSha256, "activation recovery negative proof changed");
  assert.equal(plan.negative.recoveryCloseReceiptRawSha256, recovery.close.sha256, "activation recovery Close receipt bytes changed");
  assert.equal(plan.negative.recoveryCloseReceiptSha256, recovery.close.receipt.receiptSha256, "activation recovery Close receipt digest changed");
  assert.equal(plan.negative.recoveryCloseFinalizedSlot, recovery.close.receipt.finalizedSlot, "activation recovery Close slot changed");
}

async function loadActivationProofEvidence(inputs, plan) {
  const recovery = await loadActivationRecoverySource(inputs);
  assertActivationRecoveryBindings(plan, recovery);
  if (recovery) {
    return {
      recovery,
      evidencePlan: recovery.source.plan,
      negativeProof: recovery.negative,
      proofBufferCloseReceipt: recovery.close,
    };
  }
  const negativeProof = await loadNegativeProof(inputs, plan);
  const proofBufferCloseReceipt = await loadProofBufferCloseReceipt(inputs, plan, negativeProof);
  return { recovery: null, evidencePlan: plan, negativeProof, proofBufferCloseReceipt };
}

function assertPlanBase(plan, inputs, state, { postHandoff = false } = {}) {
  assert(state.slot >= plan.plannedAtSlot, "finalized state predates the handoff plan");
  assert.equal(plan.identities.controllerConfig, state.ids.config.toBase58());
  assert.equal(plan.identities.controllerAuthority, state.ids.authority.toBase58());
  assert.equal(plan.identities.governancePolicy, state.ids.policy.toBase58());
  assert.equal(plan.identities.governanceCouncil, state.ids.council.toBase58());
  assert.equal(plan.identities.protocolGate, state.ids.gate.toBase58());
  assert.equal(plan.identities.capacityPolicy, state.ids.capacityPolicy.toBase58());
  assert.equal(plan.identities.controllerImmutabilityReceipt, state.ids.immutabilityReceipt.toBase58());
  assert.equal(plan.identities.handoffProposal, state.ids.handoffProposal.toBase58());
  assert.equal(plan.identities.handoffReceipt, state.ids.handoffReceipt.toBase58());
  assert(state.handoffProofBufferAccount, "handoff prerequisite proof buffer is absent");
  parseBufferAccount(state.handoffProofBufferAccount, inputs, "handoff prerequisite proof buffer");
  assert.equal(plan.handoff.formerAuthorityProofBuffer, inputs.bridgeEvidence.proofBuffer.toBase58(), "handoff proof-buffer identity changed");
  assert.equal(
    plan.handoff.formerAuthorityProofBufferRawSha256,
    inputs.bridgeEvidence.wrapper.value.formerAuthorityProofBufferRawSha256,
    "handoff proof-buffer raw commitment changed",
  );
  assert.deepEqual(
    plan.handoff.formerAuthorityProofBufferFingerprint,
    accountFingerprint(state.handoffProofBufferAccount),
    "handoff proof-buffer account changed since planning",
  );
  assert.equal(plan.handoff.formerAuthorityProofBufferRequiredThroughAcceptance, true, "handoff no longer requires its proof buffer through acceptance");
  assert.deepEqual(plan.baseAccountFingerprints, state.baseFingerprints, "handoff base accounts changed since planning");
  assert.equal(plan.gate.status, state.gate.status);
  assert.equal(plan.gate.epoch, state.gate.epoch.toString());
  assert.equal(plan.gate.freezeSlot, state.gate.freezeSlot.toString());
  assert.equal(plan.gate.freezeReasonCode, state.gate.freezeReasonCode);
  assert.equal(plan.governance.targetNonce, state.config.targetNonce.toString());
  assert.equal(plan.governance.councilVersion, state.council.version.toString());
  assert.equal(plan.governance.councilHash, state.council.setHash.toString("hex"));
  assert.equal(plan.governance.policyHash, state.policy.policyHash.toString("hex"));
  assertApprovalSeatRunway(plan, state, "handoff plan");
  assert.equal(plan.programdata.deployedSlot, state.targetProgramdata.deployedSlot.toString());
  assert.equal(plan.programdata.rawBytes, state.targetProgramdata.raw.length);
  assert.equal(plan.programdata.capacity, state.targetProgramdata.payload.length);
  assert.equal(plan.programdata.payloadSha256, sha256Hex(state.targetProgramdata.payload));
  assert.equal(plan.programdata.zeroTailBytes, state.targetProgramdata.payload.length - inputs.artifact.length);
  const expectedAuthority = postHandoff ? state.ids.authority : LEGACY_AUTHORITY;
  assert(state.targetProgramdata.authority?.equals(expectedAuthority), `Spread authority is not the expected ${postHandoff ? "controller" : "legacy"} authority`);
  assert.equal(
    sha256Hex(state.targetProgramdata.raw),
    postHandoff ? plan.programdata.postRawSha256 : plan.programdata.preRawSha256,
    "Spread ProgramData raw hash changed",
  );
  assert.equal(
    state.targetProgramdata.header.toString("hex"),
    postHandoff ? plan.programdata.postHeaderHex : plan.programdata.preHeaderHex,
    "Spread ProgramData header changed",
  );
}

function expectedTailAtRawCursor(plan, cursor) {
  const chunkSize = plan.observation.rawChunkSize;
  const rawLength = plan.programdata.rawBytes;
  const tailStart = PROGRAMDATA_HEADER_LEN + plan.artifact.bytes;
  let total = 0;
  for (let index = 0; index < cursor; index += 1) {
    const start = index * chunkSize;
    const end = Math.min(rawLength, start + chunkSize);
    total += Math.max(0, end - Math.max(start, tailStart));
  }
  return BigInt(total);
}

function assertObservationAgainstPlan(observation, plan, state, label = "handoff observation", options = {}) {
  const expectedPurpose = options.purpose ?? ProgramDataObservationPurposeV1.TargetHandoffBridge;
  const expectedSubject = options.subject ?? state.ids.immutabilityReceipt;
  const expectedGeneration = options.generation ?? OBSERVATION_GENERATION;
  const expectedAuthority = options.expectedAuthority ?? LEGACY_AUTHORITY;
  const expectedHeaderHex = options.expectedHeaderHex ?? plan.programdata.preHeaderHex;
  const expectedGateStatus = options.expectedGateStatus ?? state.gate.status;
  const expectedGateEpoch = options.expectedGateEpoch ?? state.gate.epoch;
  const expectedGateActiveProposal = options.expectedGateActiveProposal ?? state.gate.activeProposal;
  const expectedGateFreezeSlot = options.expectedGateFreezeSlot ?? state.gate.freezeSlot;
  const expectedGateFreezeReasonCode = options.expectedGateFreezeReasonCode ?? state.gate.freezeReasonCode;
  assert.equal(observation.bump, plan.observation.bump, `${label} bump changed`);
  assert(observation.controllerProgram.equals(CONTROLLER), `${label} controller changed`);
  assert(observation.controllerConfig.equals(state.ids.config), `${label} config changed`);
  assert(observation.capacityPolicy.equals(state.ids.capacityPolicy), `${label} capacity policy changed`);
  assert(observation.capacityPolicyDigest.equals(state.capacity.policyDigest), `${label} capacity digest changed`);
  assert.equal(observation.purpose, expectedPurpose, `${label} purpose changed`);
  assert(observation.subject.equals(expectedSubject), `${label} subject changed`);
  assert(observation.subjectDigest.equals(Buffer.from(plan.observation.subjectDigest, "hex")), `${label} subject digest changed`);
  assert.equal(observation.generation, expectedGeneration, `${label} generation changed`);
  assert(observation.protocolGate.equals(state.ids.gate), `${label} gate changed`);
  assert.equal(observation.gateStatus, expectedGateStatus, `${label} gate status changed`);
  assert.equal(observation.gateEpoch, expectedGateEpoch, `${label} gate epoch changed`);
  assert(observation.gateActiveProposal.equals(expectedGateActiveProposal), `${label} gate proposal changed`);
  assert.equal(observation.gateFreezeSlot, expectedGateFreezeSlot, `${label} gate freeze slot changed`);
  assert.equal(observation.gateFreezeReasonCode, expectedGateFreezeReasonCode, `${label} gate freeze reason changed`);
  assert(observation.targetProgram.equals(TARGET), `${label} target changed`);
  assert(observation.targetProgramdata.equals(TARGET_PROGRAMDATA), `${label} ProgramData changed`);
  assert(observation.upgradeableLoader.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), `${label} Loader changed`);
  assert(observation.programOwner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), `${label} Program owner changed`);
  assert.equal(observation.programExecutable, true, `${label} Program executable flag changed`);
  assert.equal(observation.programDataLength, BigInt(PROGRAM_ACCOUNT_LEN), `${label} Program length changed`);
  assert.equal(observation.programHeaderPresent, true, `${label} Program header is absent`);
  assert(observation.programHeaderSnapshot.equals(state.targetProgramBytes), `${label} Program header snapshot changed`);
  assert(observation.linkedProgramdata.equals(TARGET_PROGRAMDATA), `${label} linkage changed`);
  assert(observation.programdataOwner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), `${label} ProgramData owner changed`);
  assert.equal(observation.programdataExecutable, false, `${label} ProgramData executable flag changed`);
  assert.equal(observation.programdataHeaderPresent, true, `${label} ProgramData header is absent`);
  assert.equal(observation.programdataHeaderSnapshot.toString("hex"), expectedHeaderHex, `${label} ProgramData header snapshot changed`);
  assert.equal(observation.deployedSlot.toString(), plan.programdata.deployedSlot, `${label} deployed slot changed`);
  compareOptionalKey(observation.upgradeAuthority, expectedAuthority, `${label} upgrade authority`);
  assert.equal(observation.rawDataLength, BigInt(plan.programdata.rawBytes), `${label} raw length changed`);
  assert.equal(observation.payloadOffset, PROGRAMDATA_HEADER_LEN, `${label} payload offset changed`);
  assert.equal(observation.actualCapacity, BigInt(plan.programdata.capacity), `${label} capacity changed`);
  assert.equal(observation.expectedArtifactLength, BigInt(plan.artifact.bytes), `${label} artifact length changed`);
  assert(observation.expectedArtifactSha256.equals(Buffer.from(plan.artifact.sha256, "hex")), `${label} artifact SHA-256 changed`);
  assert(observation.expectedArtifactMerkleRoot.equals(Buffer.from(plan.artifact.merkleRoot, "hex")), `${label} artifact root changed`);
  assert(observation.expectedArtifactSchemeId.equals(ARTIFACT_MERKLE_SCHEME_ID), `${label} artifact scheme changed`);
  assert.equal(observation.artifactChunkSize, plan.artifact.chunkSize, `${label} artifact chunk size changed`);
  assert.equal(observation.artifactChunkCount, plan.artifact.chunkCount, `${label} artifact chunk count changed`);
  assert.equal(observation.minimumRequiredCapacity, BigInt(plan.artifact.bytes), `${label} minimum capacity changed`);
  assert(observation.rawObservationSchemeId.equals(PROGRAMDATA_OBSERVATION_MERKLE_SCHEME_ID_V1), `${label} raw scheme changed`);
  assert.equal(observation.rawChunkSize, plan.observation.rawChunkSize, `${label} raw chunk size changed`);
  assert.equal(observation.rawChunkCount, plan.observation.rawChunkCount, `${label} raw chunk count changed`);
  assert.equal(observation.rawPaddedLeafCount, plan.observation.rawPaddedLeafCount, `${label} raw padded count changed`);
  assert.equal(observation.rawTreeDepth, plan.observation.rawTreeDepth, `${label} raw tree depth changed`);
  assert(observation.nextRawChunkIndex <= observation.rawChunkCount, `${label} raw cursor exceeds its count`);
  assert(observation.nextArtifactChunkIndex <= observation.artifactChunkCount, `${label} artifact cursor exceeds its count`);
  assert.equal(observation.tailBytesVerified, expectedTailAtRawCursor(plan, observation.nextRawChunkIndex), `${label} tail cursor changed`);
  if (observation.nextRawChunkIndex < observation.rawChunkCount) {
    assert.equal(observation.nextArtifactChunkIndex, 0, `${label} artifact verification began before raw scan completion`);
  }
  if (observation.status === ProgramDataObservationStatusV1.Finalized) {
    assert.equal(observation.nextRawChunkIndex, observation.rawChunkCount, `${label} finalized before raw scan completion`);
    assert.equal(observation.nextArtifactChunkIndex, observation.artifactChunkCount, `${label} finalized before artifact verification completion`);
    assert(observation.finalRawMerkleRoot.equals(Buffer.from(plan.observation.expectedRawMerkleRoot, "hex")), `${label} raw Merkle root changed`);
    validateProgramDataObservationDigestV1(observation);
  }
}

function assertProposalAgainstPlan(proposal, plan, state, observation) {
  validateTargetAuthorityHandoffProposalDigestV1(proposal);
  assert.equal(proposal.bump, state.ids.handoffProposalBump, "handoff proposal bump changed");
  assert(proposal.clusterDomain.equals(state.config.clusterDomain), "handoff proposal cluster changed");
  assert(proposal.controllerProgram.equals(CONTROLLER), "handoff proposal controller changed");
  assert(proposal.controllerProgramdata.equals(CONTROLLER_PROGRAMDATA), "handoff proposal controller ProgramData changed");
  assert(proposal.controllerImmutabilityReceipt.equals(state.ids.immutabilityReceipt), "handoff proposal immutability receipt changed");
  assert(proposal.controllerImmutabilityDigest.equals(state.immutability.receiptDigest), "handoff proposal immutability digest changed");
  assert(proposal.controllerConfig.equals(state.ids.config), "handoff proposal config changed");
  assert(proposal.governancePolicy.equals(state.ids.policy), "handoff proposal policy changed");
  assert(proposal.governancePolicyHash.equals(state.policy.policyHash), "handoff proposal policy hash changed");
  assert(proposal.capacityPolicy.equals(state.ids.capacityPolicy), "handoff proposal capacity policy changed");
  assert(proposal.capacityPolicyDigest.equals(state.capacity.policyDigest), "handoff proposal capacity digest changed");
  assert(proposal.gate.equals(state.ids.gate), "handoff proposal gate changed");
  assert(proposal.controllerAuthority.equals(state.ids.authority), "handoff proposal controller authority changed");
  assert(proposal.targetProgram.equals(TARGET) && proposal.targetProgramdata.equals(TARGET_PROGRAMDATA), "handoff proposal target graph changed");
  assert(proposal.upgradeableLoader.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), "handoff proposal Loader changed");
  assert(proposal.legacyTargetAuthority.equals(LEGACY_AUTHORITY), "handoff proposal legacy authority changed");
  assert.equal(proposal.bridgeArtifactLength, BigInt(plan.artifact.bytes), "handoff proposal artifact length changed");
  assert(proposal.bridgeArtifactSha256.equals(Buffer.from(plan.artifact.sha256, "hex")), "handoff proposal artifact SHA-256 changed");
  assert(proposal.bridgeArtifactMerkleRoot.equals(Buffer.from(plan.artifact.merkleRoot, "hex")), "handoff proposal artifact root changed");
  assert(proposal.bridgeArtifactSchemeId.equals(ARTIFACT_MERKLE_SCHEME_ID), "handoff proposal artifact scheme changed");
  assert(proposal.bridgeSourceCommitment.equals(Buffer.from(plan.evidence.sourceEvidenceSha256, "hex")), "handoff source commitment changed");
  assert(proposal.bridgeBuildInputsCommitment.equals(Buffer.from(plan.evidence.buildInputsEvidenceSha256, "hex")), "handoff build commitment changed");
  assert(proposal.bridgePackageCommitment.equals(Buffer.from(plan.evidence.packageEvidenceSha256, "hex")), "handoff package commitment changed");
  assert(proposal.bridgeReleaseManifestCommitment.equals(Buffer.from(plan.evidence.releaseManifestSha256, "hex")), "handoff manifest commitment changed");
  assert(proposal.bridgeObservation.equals(publicKey(plan.observation.account, "planned observation")), "handoff proposal observation changed");
  assert.equal(proposal.bridgeObservationGeneration, OBSERVATION_GENERATION, "handoff proposal observation generation changed");
  assert(proposal.bridgeObservationRoot.equals(observation.finalRawMerkleRoot), "handoff proposal observation root changed");
  assert(proposal.bridgeObservationDigest.equals(observation.observationDigest), "handoff proposal observation digest changed");
  assert.equal(proposal.minimumTargetDeployedSlot.toString(), plan.programdata.deployedSlot, "handoff proposal deployed slot changed");
  assert.equal(proposal.minimumTargetCapacity, BigInt(plan.programdata.capacity), "handoff proposal capacity changed");
  assert.equal(proposal.minimumTargetRawLength, BigInt(plan.programdata.rawBytes), "handoff proposal raw length changed");
  assert.equal(proposal.bootstrapGateStatus, state.gate.status, "handoff proposal gate status changed");
  assert.equal(proposal.bootstrapGateEpoch, state.gate.epoch, "handoff proposal gate epoch changed");
  assert.equal(proposal.bootstrapFreezeReasonCode, state.gate.freezeReasonCode, "handoff proposal freeze reason changed");
  assert.equal(proposal.bootstrapFreezeSlot, state.gate.freezeSlot, "handoff proposal freeze slot changed");
  assert.equal(proposal.targetNonce, state.config.targetNonce, "handoff proposal target nonce changed");
  assert.equal(proposal.councilVersion, state.council.version, "handoff proposal council version changed");
  assert(proposal.councilHash.equals(state.council.setHash), "handoff proposal council hash changed");
  assert.equal(proposal.reviewStartSlot, proposal.creationSlot + 1n, "handoff proposal review start changed");
  assert.equal(proposal.reviewEndSlot, proposal.reviewStartSlot + state.config.voteReviewSlots, "handoff proposal review end changed");
  assert.equal(proposal.notBeforeSlot, proposal.reviewEndSlot + state.config.majorDelaySlots, "handoff proposal timelock changed");
  assert.equal(proposal.expirySlot, proposal.creationSlot + state.config.proposalExpirySlots, "handoff proposal expiry changed");
  assert.equal(proposal.approvalThreshold, 3, "handoff proposal threshold changed");
  assert(proposal.creationSlot >= BigInt(plan.plannedAtSlot), "handoff proposal predates the plan");
  assert(proposal.creationSlot <= BigInt(plan.planValidUntilSlot), "handoff proposal was created after the plan validity boundary");
  assert(proposal.approvalCount >= 0 && proposal.approvalCount <= 3, "handoff proposal approval count is invalid");
  assert.equal(proposal.approvalBitset, (1 << proposal.approvalCount) - 1, "handoff proposal approvals are not the exact first three seats");
  if (proposal.state === CeremonyProposalStateV1.Draft) assert(proposal.approvalCount < 3, "draft handoff already has quorum");
  if ([CeremonyProposalStateV1.CouncilApproved, CeremonyProposalStateV1.Timelocked, CeremonyProposalStateV1.Completed].includes(proposal.state)) {
    assert.equal(proposal.approvalCount, 3, "advanced handoff proposal lacks exact quorum");
  }
  if (proposal.state === CeremonyProposalStateV1.Completed) {
    assert(proposal.executedSlot > 0n && proposal.terminalSlot === proposal.executedSlot, "completed handoff slots changed");
    assert.equal(proposal.terminalReasonCode, CEREMONY_PROPOSAL_COMPLETED_REASON_V1, "completed handoff reason changed");
  } else {
    assert.equal(proposal.executedSlot, 0n, "uncompleted handoff has an execution slot");
    assert.equal(proposal.terminalSlot, 0n, "uncompleted handoff has a terminal slot");
  }
}

function assertReceiptAgainstPlan(receipt, proposal, plan, state, observation) {
  validateTargetAuthorityHandoffReceiptDigestV1(receipt);
  assert.equal(receipt.bump, state.ids.handoffReceiptBump, "handoff receipt bump changed");
  assert(receipt.finalized, "handoff receipt is not finalized");
  assert(receipt.proposal.equals(state.ids.handoffProposal), "handoff receipt proposal changed");
  assert(receipt.proposalDigest.equals(proposal.proposalDigest), "handoff receipt proposal digest changed");
  assert(receipt.controllerProgram.equals(CONTROLLER) && receipt.controllerConfig.equals(state.ids.config), "handoff receipt controller graph changed");
  assert(receipt.controllerAuthority.equals(state.ids.authority), "handoff receipt controller authority changed");
  assert(receipt.controllerImmutabilityReceipt.equals(state.ids.immutabilityReceipt), "handoff receipt immutability account changed");
  assert(receipt.controllerImmutabilityDigest.equals(state.immutability.receiptDigest), "handoff receipt immutability digest changed");
  assert(receipt.targetProgram.equals(TARGET) && receipt.targetProgramdata.equals(TARGET_PROGRAMDATA), "handoff receipt target graph changed");
  assert(receipt.upgradeableLoader.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), "handoff receipt Loader changed");
  assert(receipt.preObservation.equals(publicKey(plan.observation.account, "planned observation")), "handoff receipt observation changed");
  assert.equal(receipt.preObservationGeneration, OBSERVATION_GENERATION, "handoff receipt observation generation changed");
  assert(receipt.preObservationRoot.equals(observation.finalRawMerkleRoot), "handoff receipt observation root changed");
  assert(receipt.preObservationDigest.equals(observation.observationDigest), "handoff receipt observation digest changed");
  compareOptionalKey(receipt.preUpgradeAuthority, LEGACY_AUTHORITY, "handoff receipt pre-authority");
  compareOptionalKey(receipt.postUpgradeAuthority, state.ids.authority, "handoff receipt post-authority");
  assert.equal(receipt.preProgramdataHeaderSnapshot.toString("hex"), plan.programdata.preHeaderHex, "handoff receipt pre-header changed");
  assert.equal(receipt.postProgramdataHeaderSnapshot.toString("hex"), plan.programdata.postHeaderHex, "handoff receipt post-header changed");
  assert.equal(receipt.deployedSlot.toString(), plan.programdata.deployedSlot, "handoff receipt deployed slot changed");
  assert.equal(receipt.rawProgramdataLength, BigInt(plan.programdata.rawBytes), "handoff receipt raw length changed");
  assert.equal(receipt.programdataCapacity, BigInt(plan.programdata.capacity), "handoff receipt capacity changed");
  assert.equal(receipt.artifactLength, BigInt(plan.artifact.bytes), "handoff receipt artifact length changed");
  assert(receipt.artifactSha256.equals(Buffer.from(plan.artifact.sha256, "hex")), "handoff receipt artifact SHA-256 changed");
  assert(receipt.artifactMerkleRoot.equals(Buffer.from(plan.artifact.merkleRoot, "hex")), "handoff receipt artifact root changed");
  assert(receipt.artifactSchemeId.equals(ARTIFACT_MERKLE_SCHEME_ID), "handoff receipt artifact scheme changed");
  assert(receipt.bridgeSourceCommitment.equals(Buffer.from(plan.evidence.sourceEvidenceSha256, "hex")), "handoff receipt source commitment changed");
  assert(receipt.bridgeBuildInputsCommitment.equals(Buffer.from(plan.evidence.buildInputsEvidenceSha256, "hex")), "handoff receipt build commitment changed");
  assert(receipt.bridgePackageCommitment.equals(Buffer.from(plan.evidence.packageEvidenceSha256, "hex")), "handoff receipt package commitment changed");
  assert(receipt.bridgeReleaseManifestCommitment.equals(Buffer.from(plan.evidence.releaseManifestSha256, "hex")), "handoff receipt manifest commitment changed");
  assert.equal(receipt.bootstrapGateEpoch, state.gate.epoch, "handoff receipt gate epoch changed");
  assert.equal(receipt.targetNonce, state.config.targetNonce, "handoff receipt target nonce changed");
  assert.equal(receipt.councilVersion, state.council.version, "handoff receipt council version changed");
  assert.equal(receipt.acceptedSlot, proposal.executedSlot, "handoff receipt accepted slot changed");
}

function assertActivationProposalAgainstPlan(proposal, plan, state, observation, handoff) {
  validateBootstrapActivationProposalDigestV1(proposal);
  assert.equal(proposal.bump, state.ids.activationProposalBump, "activation proposal bump changed");
  assert(proposal.clusterDomain.equals(state.config.clusterDomain), "activation proposal cluster changed");
  assert(proposal.controllerProgram.equals(CONTROLLER), "activation proposal controller changed");
  assert(proposal.controllerProgramdata.equals(CONTROLLER_PROGRAMDATA), "activation proposal controller ProgramData changed");
  assert(proposal.controllerConfig.equals(state.ids.config), "activation proposal config changed");
  assert(proposal.governancePolicy.equals(state.ids.policy), "activation proposal policy changed");
  assert(proposal.governancePolicyHash.equals(state.policy.policyHash), "activation proposal policy hash changed");
  assert(proposal.capacityPolicy.equals(state.ids.capacityPolicy), "activation proposal capacity policy changed");
  assert(proposal.capacityPolicyDigest.equals(state.capacity.policyDigest), "activation proposal capacity digest changed");
  assert(proposal.controllerImmutabilityReceipt.equals(state.ids.immutabilityReceipt), "activation proposal immutability receipt changed");
  assert(proposal.controllerImmutabilityDigest.equals(state.immutability.receiptDigest), "activation proposal immutability digest changed");
  assert(proposal.targetHandoffReceipt.equals(state.ids.handoffReceipt), "activation proposal handoff receipt changed");
  assert(proposal.targetHandoffDigest.equals(handoff.receiptDigest), "activation proposal handoff digest changed");
  assert(proposal.gate.equals(state.ids.gate), "activation proposal gate changed");
  assert(proposal.targetProgram.equals(TARGET) && proposal.targetProgramdata.equals(TARGET_PROGRAMDATA), "activation proposal target graph changed");
  assert(proposal.upgradeableLoader.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), "activation proposal Loader changed");
  assert(proposal.controllerAuthority.equals(state.ids.authority), "activation proposal controller authority changed");
  assert.equal(proposal.bridgeArtifactLength, BigInt(plan.artifact.bytes), "activation proposal artifact length changed");
  assert(proposal.bridgeArtifactSha256.equals(Buffer.from(plan.artifact.sha256, "hex")), "activation proposal artifact SHA-256 changed");
  assert(proposal.bridgeArtifactMerkleRoot.equals(Buffer.from(plan.artifact.merkleRoot, "hex")), "activation proposal artifact root changed");
  assert(proposal.bridgeArtifactSchemeId.equals(ARTIFACT_MERKLE_SCHEME_ID), "activation proposal artifact scheme changed");
  assert(proposal.bridgeSourceCommitment.equals(handoff.bridgeSourceCommitment), "activation proposal source commitment changed");
  assert(proposal.bridgeBuildInputsCommitment.equals(handoff.bridgeBuildInputsCommitment), "activation proposal build commitment changed");
  assert(proposal.bridgePackageCommitment.equals(handoff.bridgePackageCommitment), "activation proposal package commitment changed");
  assert(proposal.bridgeReleaseManifestCommitment.equals(handoff.bridgeReleaseManifestCommitment), "activation proposal manifest commitment changed");
  assert(proposal.bridgeObservation.equals(publicKey(plan.observation.account, "activation observation")), "activation proposal observation changed");
  assert.equal(proposal.bridgeObservationGeneration, ACTIVATION_OBSERVATION_GENERATION, "activation proposal observation generation changed");
  assert(proposal.bridgeObservationRoot.equals(observation.finalRawMerkleRoot), "activation proposal observation root changed");
  assert(proposal.bridgeObservationDigest.equals(observation.observationDigest), "activation proposal observation digest changed");
  assert.equal(proposal.minimumTargetDeployedSlot.toString(), plan.programdata.deployedSlot, "activation proposal deployed slot changed");
  assert.equal(proposal.minimumTargetCapacity, BigInt(plan.programdata.capacity), "activation proposal capacity changed");
  assert.equal(proposal.minimumTargetRawLength, BigInt(plan.programdata.rawBytes), "activation proposal raw length changed");
  assert.equal(proposal.bootstrapGateStatus, GateStatusV1.EmergencyFrozen, "activation proposal bootstrap gate status changed");
  assert.equal(proposal.bootstrapGateEpoch.toString(), plan.gate.epoch, "activation proposal gate epoch changed");
  assert.equal(proposal.bootstrapFreezeReasonCode, plan.gate.freezeReasonCode, "activation proposal freeze reason changed");
  assert.equal(proposal.bootstrapFreezeSlot.toString(), plan.gate.freezeSlot, "activation proposal freeze slot changed");
  assert.equal(proposal.targetNonce.toString(), plan.governance.targetNonce, "activation proposal target nonce changed");
  assert.equal(proposal.councilVersion.toString(), plan.governance.councilVersion, "activation proposal council version changed");
  assert.equal(proposal.councilHash.toString("hex"), plan.governance.councilHash, "activation proposal council hash changed");
  assert.equal(proposal.reviewStartSlot, proposal.creationSlot + 1n, "activation proposal review start changed");
  assert.equal(proposal.reviewEndSlot, proposal.reviewStartSlot + state.config.voteReviewSlots, "activation proposal review end changed");
  assert.equal(proposal.notBeforeSlot, proposal.reviewEndSlot + state.config.majorDelaySlots, "activation proposal timelock changed");
  assert.equal(proposal.expirySlot, proposal.creationSlot + state.config.proposalExpirySlots, "activation proposal expiry changed");
  assert(proposal.creationSlot >= BigInt(plan.plannedAtSlot) && proposal.creationSlot <= BigInt(plan.planValidUntilSlot), "activation proposal creation slot is outside the plan");
  assert.equal(proposal.approvalThreshold, 3, "activation proposal threshold changed");
  assert(proposal.approvalCount >= 0 && proposal.approvalCount <= 3, "activation approval count is invalid");
  assert.equal(proposal.approvalBitset, (1 << proposal.approvalCount) - 1, "activation approvals are not the exact first three seats");
  if ([CeremonyProposalStateV1.CouncilApproved, CeremonyProposalStateV1.Timelocked, CeremonyProposalStateV1.Completed].includes(proposal.state)) {
    assert.equal(proposal.approvalCount, 3, "advanced activation proposal lacks exact quorum");
  }
  if (proposal.state === CeremonyProposalStateV1.Completed) {
    assert(proposal.executedSlot > 0n && proposal.terminalSlot === proposal.executedSlot, "completed activation slots changed");
    assert.equal(proposal.terminalReasonCode, CEREMONY_PROPOSAL_COMPLETED_REASON_V1, "completed activation reason changed");
  } else {
    assert.equal(proposal.executedSlot, 0n, "uncompleted activation has an execution slot");
    assert.equal(proposal.terminalSlot, 0n, "uncompleted activation has a terminal slot");
  }
}

function assertActivationFinalAccounts(receipt, deployment, proposal, plan, state, observation, handoff) {
  validateBootstrapActivationReceiptDigestV1(receipt);
  validateCurrentDeploymentDigestV1(deployment);
  assert.equal(receipt.bump, state.ids.activationReceiptBump, "activation receipt bump changed");
  assert(receipt.finalized, "activation receipt is not finalized");
  assert(receipt.proposal.equals(state.ids.activationProposal) && receipt.proposalDigest.equals(proposal.proposalDigest), "activation receipt proposal changed");
  assert(receipt.controllerProgram.equals(CONTROLLER) && receipt.controllerConfig.equals(state.ids.config), "activation receipt controller graph changed");
  assert(receipt.governancePolicy.equals(state.ids.policy) && receipt.governancePolicyHash.equals(state.policy.policyHash), "activation receipt policy changed");
  assert(receipt.capacityPolicy.equals(state.ids.capacityPolicy) && receipt.capacityPolicyDigest.equals(state.capacity.policyDigest), "activation receipt capacity policy changed");
  assert(receipt.controllerImmutabilityReceipt.equals(state.ids.immutabilityReceipt) && receipt.controllerImmutabilityDigest.equals(state.immutability.receiptDigest), "activation receipt immutability proof changed");
  assert(receipt.targetHandoffReceipt.equals(state.ids.handoffReceipt) && receipt.targetHandoffDigest.equals(handoff.receiptDigest), "activation receipt handoff proof changed");
  assert(receipt.gate.equals(state.ids.gate), "activation receipt gate changed");
  assert(receipt.targetProgram.equals(TARGET) && receipt.targetProgramdata.equals(TARGET_PROGRAMDATA), "activation receipt target graph changed");
  assert(receipt.upgradeableLoader.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), "activation receipt Loader changed");
  assert(receipt.controllerAuthority.equals(state.ids.authority), "activation receipt controller authority changed");
  assert(receipt.bridgeObservation.equals(publicKey(plan.observation.account, "activation observation")), "activation receipt observation changed");
  assert.equal(receipt.bridgeObservationGeneration, ACTIVATION_OBSERVATION_GENERATION, "activation receipt observation generation changed");
  assert(receipt.bridgeObservationRoot.equals(observation.finalRawMerkleRoot) && receipt.bridgeObservationDigest.equals(observation.observationDigest), "activation receipt observation proof changed");
  assert.equal(receipt.bridgeArtifactLength, BigInt(plan.artifact.bytes), "activation receipt artifact length changed");
  assert(receipt.bridgeArtifactSha256.equals(Buffer.from(plan.artifact.sha256, "hex")), "activation receipt artifact SHA-256 changed");
  assert(receipt.bridgeArtifactMerkleRoot.equals(Buffer.from(plan.artifact.merkleRoot, "hex")) && receipt.bridgeArtifactSchemeId.equals(ARTIFACT_MERKLE_SCHEME_ID), "activation receipt artifact commitment changed");
  assert.equal(receipt.actualTargetCapacity, BigInt(plan.programdata.capacity), "activation receipt target capacity changed");
  assert.equal(receipt.targetDeployedSlot.toString(), plan.programdata.deployedSlot, "activation receipt deployed slot changed");
  assert.equal(receipt.previousGateStatus, GateStatusV1.EmergencyFrozen, "activation receipt previous gate status changed");
  assert.equal(receipt.previousGateEpoch.toString(), plan.gate.epoch, "activation receipt previous gate epoch changed");
  assert.equal(receipt.previousFreezeReasonCode, plan.gate.freezeReasonCode, "activation receipt previous freeze reason changed");
  assert.equal(receipt.previousFreezeSlot.toString(), plan.gate.freezeSlot, "activation receipt previous freeze slot changed");
  assert.equal(receipt.activatedGateStatus, GateStatusV1.Active, "activation receipt post-gate status changed");
  assert.equal(receipt.activatedGateEpoch.toString(), plan.gate.nextEpoch, "activation receipt post-gate epoch changed");
  assert.equal(receipt.targetNonce.toString(), plan.governance.targetNonce, "activation receipt target nonce changed");
  assert.equal(receipt.councilVersion.toString(), plan.governance.councilVersion, "activation receipt council version changed");
  assert.equal(receipt.councilHash.toString("hex"), plan.governance.councilHash, "activation receipt council hash changed");
  assert(receipt.currentDeploymentState.equals(state.ids.currentDeployment), "activation receipt deployment account changed");
  assert(receipt.currentDeploymentDigest.equals(deployment.deploymentDigest), "activation receipt deployment digest changed");
  assert.equal(receipt.deploymentGeneration, 1n, "activation receipt deployment generation changed");
  assert.equal(receipt.finalizedSlot, proposal.executedSlot, "activation receipt finalized slot changed");
  assert.equal(deployment.bump, state.ids.currentDeploymentBump, "current deployment bump changed");
  assert(deployment.controllerProgram.equals(CONTROLLER) && deployment.controllerConfig.equals(state.ids.config), "current deployment controller graph changed");
  assert(deployment.capacityPolicy.equals(state.ids.capacityPolicy) && deployment.capacityPolicyDigest.equals(state.capacity.policyDigest), "current deployment capacity policy changed");
  assert(deployment.targetProgram.equals(TARGET) && deployment.targetProgramdata.equals(TARGET_PROGRAMDATA), "current deployment target graph changed");
  assert(deployment.upgradeableLoader.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), "current deployment Loader changed");
  assert(deployment.controllerAuthority.equals(state.ids.authority) && deployment.installedAuthority.equals(state.ids.authority), "current deployment authority changed");
  assert.equal(deployment.artifactLength, BigInt(plan.artifact.bytes), "current deployment artifact length changed");
  assert(deployment.artifactSha256.equals(Buffer.from(plan.artifact.sha256, "hex")), "current deployment artifact SHA-256 changed");
  assert(deployment.artifactMerkleRoot.equals(Buffer.from(plan.artifact.merkleRoot, "hex")) && deployment.artifactSchemeId.equals(ARTIFACT_MERKLE_SCHEME_ID), "current deployment artifact commitment changed");
  assert.equal(deployment.actualProgramdataCapacity, BigInt(plan.programdata.capacity), "current deployment capacity changed");
  assert(deployment.programdataObservation.equals(publicKey(plan.observation.account, "activation observation")), "current deployment observation changed");
  assert.equal(deployment.observationGeneration, ACTIVATION_OBSERVATION_GENERATION, "current deployment observation generation changed");
  assert(deployment.observationRoot.equals(observation.finalRawMerkleRoot) && deployment.observationDigest.equals(observation.observationDigest), "current deployment observation proof changed");
  assert.equal(deployment.deployedSlot.toString(), plan.programdata.deployedSlot, "current deployment deployed slot changed");
  assert(deployment.sourceCommitment.equals(handoff.bridgeSourceCommitment) && deployment.buildInputsCommitment.equals(handoff.bridgeBuildInputsCommitment), "current deployment source/build commitment changed");
  assert(deployment.packageCommitment.equals(handoff.bridgePackageCommitment) && deployment.releaseManifestCommitment.equals(handoff.bridgeReleaseManifestCommitment), "current deployment package/manifest commitment changed");
  assert(deployment.releaseCommitment.equals(state.ids.handoffReceipt) && deployment.releaseCommitmentDigest.equals(handoff.receiptDigest), "current deployment handoff commitment changed");
  compareOptionalKey(deployment.activationReceipt, state.ids.activationReceipt, "current deployment activation receipt");
  compareOptionalKey(deployment.completedProposal, null, "current deployment completed proposal");
  assert.equal(deployment.gateEpochAtActivation.toString(), plan.gate.nextEpoch, "current deployment activation epoch changed");
  assert.equal(deployment.deploymentGeneration, 1n, "current deployment generation changed");
  assert.equal(deployment.lastUpdatedSlot, receipt.finalizedSlot, "current deployment finalized slot changed");
}

async function readProgress(connection, inputs, plan, minContextSlot = 0) {
  const keys = [
    publicKey(plan.observation.account, "planned observation"),
    publicKey(plan.handoff.proposal, "planned handoff proposal"),
    publicKey(plan.handoff.receipt, "planned handoff receipt"),
  ];
  const response = await connection.getMultipleAccountsInfoAndContext(keys, finalizedConfig(minContextSlot));
  assert(response.context.slot >= minContextSlot, "handoff progress read predates its minimum context slot");
  const [observationAccount, proposalAccount, receiptAccount] = response.value;
  let observation = null;
  let proposal = null;
  let receipt = null;
  if (observationAccount && !(observationAccount.owner.equals(SystemProgram.programId) && observationAccount.data.length === 0)) {
    observation = deserializeProgramDataObservationV1(
      assertAccount(observationAccount, CONTROLLER, PROGRAMDATA_OBSERVATION_V1_LEN, "handoff observation").data,
    );
  } else assertVacant(observationAccount, "handoff observation");
  if (proposalAccount && !(proposalAccount.owner.equals(SystemProgram.programId) && proposalAccount.data.length === 0)) {
    proposal = deserializeTargetAuthorityHandoffProposalV1(
      assertAccount(proposalAccount, CONTROLLER, TARGET_AUTHORITY_HANDOFF_PROPOSAL_V1_LEN, "handoff proposal").data,
    );
  } else assertVacant(proposalAccount, "handoff proposal");
  if (receiptAccount && !(receiptAccount.owner.equals(SystemProgram.programId) && receiptAccount.data.length === 0)) {
    receipt = deserializeTargetAuthorityHandoffReceiptV1(
      assertAccount(receiptAccount, CONTROLLER, TARGET_AUTHORITY_HANDOFF_RECEIPT_V1_LEN, "handoff receipt").data,
    );
  } else assertVacant(receiptAccount, "handoff receipt");
  return { slot: response.context.slot, observation, proposal, receipt, accounts: response.value };
}

function blueprintForStage(plan, stage) {
  const candidates = [
    ...plan.transactionBlueprints.observation,
    plan.transactionBlueprints.create,
    ...plan.transactionBlueprints.approvals,
    plan.transactionBlueprints.queue,
    plan.transactionBlueprints.accept,
  ];
  const result = candidates.find((entry) => entry.stage === stage);
  assert(result, `journal references unknown handoff stage ${stage}`);
  return result;
}

function assertClosedEnvelope(stage, instructions) {
  const manifests = instructions.map(instructionManifest);
  if (stage.startsWith("observation-") || stage.startsWith("activation-observation-") || stage === "handoff-accept" || stage === "activation-execute") {
    assert.equal(instructions.length, 3, `${stage} must contain exactly two ComputeBudget instructions and one controller instruction`);
    assert(instructions[0].programId.equals(ComputeBudgetProgram.programId), `${stage} compute-limit program changed`);
    assert(instructions[1].programId.equals(ComputeBudgetProgram.programId), `${stage} compute-price program changed`);
    assert(instructions[2].programId.equals(CONTROLLER), `${stage} controller instruction changed`);
    assert.deepEqual(manifests.slice(0, 2), computePrefix().map(instructionManifest), `${stage} ComputeBudget prefix changed`);
  } else {
    assert.equal(instructions.length, 1, `${stage} must contain one exact controller instruction`);
    assert(instructions[0].programId.equals(CONTROLLER), `${stage} controller instruction changed`);
  }
  assert(instructions.at(-1).programId.equals(CONTROLLER), `${stage} has an instruction after the controller operation`);
}

function assertStageBlueprint(plan, action) {
  const blueprint = blueprintForStage(plan, action.stage);
  assertClosedEnvelope(action.stage, action.instructions);
  const actual = normalizedPacket(action.instructions, action.signers);
  assert.equal(actual.packetBytes, blueprint.packetBytes, `${action.stage} packet length changed`);
  assert.deepEqual(actual.expectedSigners, blueprint.expectedSigners, `${action.stage} signer set changed`);
  if (blueprint.dynamicFields.length === 0) {
    assert.deepEqual(actual.instructions, blueprint.instructions, `${action.stage} instruction bytes changed`);
    assert.equal(actual.normalizedMessageSha256, blueprint.normalizedMessageSha256, `${action.stage} normalized message changed`);
  } else {
    assert.equal(actual.instructions.length, blueprint.instructions.length, `${action.stage} instruction count changed`);
    actual.instructions.forEach((instruction, index) => {
      const expected = blueprint.instructions[index];
      assert.equal(instruction.programId, expected.programId, `${action.stage} instruction ${index} program changed`);
      assert.deepEqual(instruction.accounts, expected.accounts, `${action.stage} instruction ${index} accounts changed`);
      assert.equal(instruction.dataBytes, expected.dataBytes, `${action.stage} instruction ${index} data length changed`);
      assert.equal(instruction.dataHex.slice(0, 2), expected.dataHex.slice(0, 2), `${action.stage} instruction ${index} tag changed`);
    });
  }
  return blueprint;
}

function activationBlueprintForStage(plan, stage) {
  const candidates = [
    plan.transactionBlueprints.negative,
    plan.transactionBlueprints.close,
    ...plan.transactionBlueprints.observation,
    plan.transactionBlueprints.create,
    ...plan.transactionBlueprints.approvals,
    plan.transactionBlueprints.queue,
    plan.transactionBlueprints.execute,
    plan.transactionBlueprints.probes.oldEpoch,
    plan.transactionBlueprints.probes.currentEpoch,
  ];
  const result = candidates.find((entry) => entry.stage === stage);
  assert(result, `journal references unknown activation stage ${stage}`);
  return result;
}

function assertActivationStageBlueprint(plan, action) {
  const blueprint = activationBlueprintForStage(plan, action.stage);
  if (action.stage.startsWith("activation-observation-") || action.stage === "activation-execute") {
    assertClosedEnvelope(action.stage, action.instructions);
  } else if (action.stage.startsWith("activation-") && action.stage !== "former-authority-negative") {
    assert.equal(action.instructions.length, 1, `${action.stage} must contain one controller instruction`);
    assert(action.instructions[0].programId.equals(CONTROLLER), `${action.stage} controller program changed`);
  } else if (action.stage === "former-authority-negative") {
    assert.equal(action.instructions.length, 1, "former-authority negative transaction must contain one Loader instruction");
    assert(action.instructions[0].programId.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), "former-authority negative transaction is not a direct Loader instruction");
    assert.equal(action.instructions[0].data.toString("hex"), LOADER_UPGRADE_DATA.toString("hex"), "former-authority Loader instruction changed");
  } else if (action.stage === "former-authority-proof-buffer-close") {
    assert.equal(action.instructions.length, 1, "proof-buffer close transaction must contain one Loader instruction");
    assert(action.instructions[0].programId.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), "proof-buffer close transaction is not a direct Loader instruction");
    assert.equal(action.instructions[0].data.toString("hex"), LOADER_CLOSE_DATA.toString("hex"), "proof-buffer Loader Close instruction changed");
    assert.deepEqual(
      action.instructions[0].keys.map((entry) => ({
        pubkey: entry.pubkey.toBase58(),
        signer: entry.isSigner,
        writable: entry.isWritable,
      })),
      [
        { pubkey: plan.identities.proofBuffer, signer: false, writable: true },
        { pubkey: TREASURY.toBase58(), signer: false, writable: true },
        { pubkey: LEGACY_AUTHORITY.toBase58(), signer: true, writable: false },
      ],
      "proof-buffer Loader Close account contract changed",
    );
  } else if (action.stage.startsWith("simulate-")) {
    assert.equal(action.instructions.length, 1, `${action.stage} must contain one simulation-only Spread instruction`);
    assert(action.instructions[0].programId.equals(TARGET), `${action.stage} target program changed`);
    assert.equal(action.instructions[0].keys.length, 1, `${action.stage} acquired a business account`);
    assert.equal(action.instructions[0].keys[0].isSigner, false, `${action.stage} acquired a business signer`);
    assert.equal(action.instructions[0].keys[0].isWritable, false, `${action.stage} acquired a writable account`);
    assert(action.instructions[0].keys[0].pubkey.equals(publicKey(plan.identities.protocolGate, "planned gate")), `${action.stage} final gate changed`);
  }
  const actual = normalizedPacket(action.instructions, action.signers);
  assert.equal(actual.packetBytes, blueprint.packetBytes, `${action.stage} packet length changed`);
  assert.deepEqual(actual.expectedSigners, blueprint.expectedSigners, `${action.stage} signer set changed`);
  if (blueprint.dynamicFields.length === 0) {
    assert.deepEqual(actual.instructions, blueprint.instructions, `${action.stage} instruction bytes changed`);
    assert.equal(actual.normalizedMessageSha256, blueprint.normalizedMessageSha256, `${action.stage} normalized message changed`);
  } else {
    assert.equal(actual.instructions.length, blueprint.instructions.length, `${action.stage} instruction count changed`);
    actual.instructions.forEach((instruction, index) => {
      const expected = blueprint.instructions[index];
      assert.equal(instruction.programId, expected.programId, `${action.stage} instruction ${index} program changed`);
      assert.deepEqual(instruction.accounts, expected.accounts, `${action.stage} instruction ${index} accounts changed`);
      assert.equal(instruction.dataBytes, expected.dataBytes, `${action.stage} instruction ${index} data length changed`);
      assert.equal(instruction.dataHex.slice(0, 2), expected.dataHex.slice(0, 2), `${action.stage} instruction ${index} tag changed`);
    });
  }
  return blueprint;
}

function nextActivationAction(validated, negativeProof, proofBufferCloseReceipt, plan) {
  const { state, progress, model, handoffReceipt } = validated;
  if (!negativeProof) {
    assert.equal(state.gate.status, GateStatusV1.EmergencyFrozen, "negative proof cannot begin after activation");
    assert(validated.proofBufferAccount, "former-authority negative proof requires the exact live proof buffer");
    return {
      stage: "former-authority-negative",
      instructions: [directFormerAuthorityUpgradeInstruction(publicKey(plan.identities.proofBuffer, "planned proof buffer"))],
      signers: [PAYER, LEGACY_AUTHORITY],
      kmsRole: "legacy-target-authority",
    };
  }
  if (!proofBufferCloseReceipt) {
    assert.equal(state.gate.status, GateStatusV1.EmergencyFrozen, "proof buffer cannot close after activation");
    assert(validated.proofBufferAccount, "proof-buffer Close requires the exact live proof buffer");
    return {
      stage: "former-authority-proof-buffer-close",
      instructions: [directFormerAuthorityCloseBufferInstruction(publicKey(plan.identities.proofBuffer, "planned proof buffer"))],
      signers: [PAYER, LEGACY_AUTHORITY],
      kmsRole: "legacy-target-authority",
    };
  }
  assert.equal(validated.proofBufferAccount, null, "activation requires the former-authority proof buffer to be closed");
  if (!progress.observation) {
    assert(model, "activation observation model is unavailable");
    return {
      stage: "activation-observation-begin",
      instructions: [...computePrefix(), model.begin],
      signers: [PAYER],
      kmsRole: null,
    };
  }
  const observation = progress.observation;
  if (observation.status === ProgramDataObservationStatusV1.Accumulating) {
    assert(model, "activation observation model is unavailable while accumulating");
    if (observation.nextRawChunkIndex < observation.rawChunkCount) {
      const index = observation.nextRawChunkIndex;
      return {
        stage: `activation-observation-raw-${String(index).padStart(3, "0")}`,
        instructions: [...computePrefix(), model.appends[index]],
        signers: [PAYER],
        kmsRole: null,
      };
    }
    assert.equal(observation.nextRawChunkIndex, observation.rawChunkCount, "activation raw cursor exceeds count");
    assert(observation.nextArtifactChunkIndex < observation.artifactChunkCount, "activation observation has no remaining work");
    const index = observation.nextArtifactChunkIndex;
    return {
      stage: `activation-observation-artifact-${String(index).padStart(3, "0")}`,
      instructions: [...computePrefix(), model.verifies[index]],
      signers: [PAYER],
      kmsRole: null,
    };
  }
  if (observation.status === ProgramDataObservationStatusV1.ReadyToFinalize) {
    assert(model, "activation observation model is unavailable before finalization");
    return {
      stage: "activation-observation-finalize",
      instructions: [...computePrefix(), model.finalize],
      signers: [PAYER],
      kmsRole: null,
    };
  }
  assert.equal(observation.status, ProgramDataObservationStatusV1.Finalized, "activation observation entered an unsupported state");
  const accounts = activationAccounts(state, publicKey(plan.observation.account, "activation observation"));
  if (!progress.proposal) {
    const instruction = buildCreateBootstrapActivationV1Instruction(CONTROLLER, accounts.create, {
      expectedControllerImmutabilityDigest: state.immutability.receiptDigest,
      expectedHandoffReceiptDigest: handoffReceipt.receiptDigest,
      expectedBridgeObservationDigest: observation.observationDigest,
      expectedGateEpoch: state.gate.epoch,
      expectedTargetNonce: state.config.targetNonce,
      expectedCouncilVersion: state.council.version,
      planValidUntilSlot: BigInt(plan.planValidUntilSlot),
    });
    return { stage: "activation-create", instructions: [instruction], signers: [PAYER, SEATS[0]], kmsRole: "seat-0" };
  }
  const proposal = progress.proposal;
  assert(BigInt(state.slot) < proposal.expirySlot, "bootstrap activation proposal expired");
  if (proposal.state === CeremonyProposalStateV1.Draft) {
    if (BigInt(state.slot) < proposal.reviewStartSlot) {
      return { pause: "review-window", resumeAtSlot: proposal.reviewStartSlot.toString(), proposalDigest: proposal.proposalDigest.toString("hex") };
    }
    assert(BigInt(state.slot) <= proposal.reviewEndSlot, "activation review window closed before quorum");
    const index = proposal.approvalCount;
    assert(index >= 0 && index < 3, "activation approval cursor is invalid");
    const instruction = buildApproveBootstrapActivationV1Instruction(CONTROLLER, {
      ...accounts.common,
      seatAuthority: SEATS[index],
    }, {
      expectedProposalDigest: proposal.proposalDigest,
      expectedCouncilVersion: state.council.version,
      expectedGateEpoch: state.gate.epoch,
      expectedTargetNonce: state.config.targetNonce,
    });
    return {
      stage: `activation-approve-${index}`,
      instructions: [instruction],
      signers: [PAYER, SEATS[index]],
      kmsRole: `seat-${index}`,
    };
  }
  if (proposal.state === CeremonyProposalStateV1.CouncilApproved) {
    const instruction = buildQueueBootstrapActivationV1Instruction(CONTROLLER, accounts.common, {
      expectedProposalDigest: proposal.proposalDigest,
      expectedCouncilVersion: state.council.version,
      expectedGateEpoch: state.gate.epoch,
      expectedTargetNonce: state.config.targetNonce,
    });
    return { stage: "activation-queue", instructions: [instruction], signers: [PAYER], kmsRole: null };
  }
  if (proposal.state === CeremonyProposalStateV1.Timelocked) {
    if (BigInt(state.slot) < proposal.notBeforeSlot) {
      return { pause: "timelock", resumeAtSlot: proposal.notBeforeSlot.toString(), proposalDigest: proposal.proposalDigest.toString("hex") };
    }
    const digests = activationPlanDigests(
      state,
      publicKey(plan.observation.account, "activation observation"),
      observation,
      handoffReceipt,
      proposal.proposalDigest,
    );
    const instruction = buildExecuteBootstrapActivationV1Instruction(CONTROLLER, accounts.execute, {
      expectedProposalDigest: proposal.proposalDigest,
      expectedBridgeObservationDigest: observation.observationDigest,
      expectedGateEpoch: state.gate.epoch,
      expectedTargetNonce: state.config.targetNonce,
      expectedDeploymentPlanDigest: digests.deploymentPlanDigest,
      expectedReceiptPlanDigest: digests.receiptPlanDigest,
      envelope: envelope(),
    });
    return {
      stage: "activation-execute",
      instructions: [...computePrefix(), instruction],
      signers: [PAYER],
      kmsRole: null,
    };
  }
  if (proposal.state === CeremonyProposalStateV1.Completed) {
    assert(progress.receipt && progress.deployment, "completed activation lacks final accounts");
    return { done: true };
  }
  throw new Error(`activation proposal entered unsupported state ${proposal.state}`);
}

async function validatedLiveState(connection, inputs, plan, minContextSlot = 0) {
  const state = await readBaseState(connection, inputs, Math.max(minContextSlot, plan.plannedAtSlot));
  const bridgeEvidenceSlot = inputs.bridgeEvidence.repeatReceipt.value.historyExclusion.throughInclusiveSlot;
  const proofBufferRead = await connection.getAccountInfoAndContext(
    inputs.bridgeEvidence.proofBuffer,
    finalizedConfig(Math.max(state.slot, bridgeEvidenceSlot)),
  );
  assert(
    proofBufferRead.context.slot >= Math.max(state.slot, bridgeEvidenceSlot),
    "handoff proof-buffer reread predates its bridge evidence",
  );
  parseBufferAccount(proofBufferRead.value, inputs, "handoff prerequisite proof buffer");
  state.handoffProofBufferAccount = proofBufferRead.value;
  state.slot = proofBufferRead.context.slot;
  const isLegacy = state.targetProgramdata.authority?.equals(LEGACY_AUTHORITY) ?? false;
  const isController = state.targetProgramdata.authority?.equals(state.ids.authority) ?? false;
  assert(isLegacy || isController, "Spread ProgramData authority is neither the legacy authority nor the controller PDA");
  assertPlanBase(plan, inputs, state, { postHandoff: isController });
  const progress = await readProgress(connection, inputs, plan, state.slot);
  state.slot = progress.slot;
  if (!progress.proposal) {
    assert(BigInt(state.slot) <= BigInt(plan.planValidUntilSlot), "Spread handoff creation plan expired");
  }
  if (progress.observation) assertObservationAgainstPlan(progress.observation, plan, state);
  if (progress.proposal) {
    assert(progress.observation, "handoff proposal exists without its finalized observation");
    assert.equal(progress.observation.status, ProgramDataObservationStatusV1.Finalized, "handoff proposal exists before observation finalization");
    assertProposalAgainstPlan(progress.proposal, plan, state, progress.observation);
  }
  if (progress.receipt) {
    assert(progress.proposal, "handoff receipt exists without its proposal");
    assert.equal(progress.proposal.state, CeremonyProposalStateV1.Completed, "handoff receipt exists before proposal completion");
    assert.equal(isController, true, "handoff receipt exists without controller authority");
    assertReceiptAgainstPlan(progress.receipt, progress.proposal, plan, state, progress.observation);
  } else {
    assert.equal(isLegacy, true, "Spread authority changed without a finalized handoff receipt");
    assert(!progress.proposal || progress.proposal.state !== CeremonyProposalStateV1.Completed, "completed proposal lacks its atomic receipt");
  }
  return { state, progress, model: isLegacy ? observationModel(inputs, state) : null };
}

function nextAction(validated, inputs, plan) {
  const { state, progress, model } = validated;
  if (!progress.observation) {
    assert(model, "observation model is unavailable before handoff");
    return {
      stage: "observation-begin",
      instructions: [...computePrefix(), model.begin],
      signers: [PAYER],
      kmsRole: null,
    };
  }
  const observation = progress.observation;
  if (observation.status === ProgramDataObservationStatusV1.Accumulating) {
    assert(model, "observation model is unavailable while accumulating");
    if (observation.nextRawChunkIndex < observation.rawChunkCount) {
      const index = observation.nextRawChunkIndex;
      return {
        stage: `observation-raw-${String(index).padStart(3, "0")}`,
        instructions: [...computePrefix(), model.appends[index]],
        signers: [PAYER],
        kmsRole: null,
      };
    }
    assert.equal(observation.nextRawChunkIndex, observation.rawChunkCount, "raw cursor exceeds count");
    assert(observation.nextArtifactChunkIndex < observation.artifactChunkCount, "accumulating observation has no remaining work");
    const index = observation.nextArtifactChunkIndex;
    return {
      stage: `observation-artifact-${String(index).padStart(3, "0")}`,
      instructions: [...computePrefix(), model.verifies[index]],
      signers: [PAYER],
      kmsRole: null,
    };
  }
  if (observation.status === ProgramDataObservationStatusV1.ReadyToFinalize) {
    assert(model, "observation model is unavailable before finalization");
    return {
      stage: "observation-finalize",
      instructions: [...computePrefix(), model.finalize],
      signers: [PAYER],
      kmsRole: null,
    };
  }
  assert.equal(observation.status, ProgramDataObservationStatusV1.Finalized, "handoff observation entered an unsupported state");
  const accounts = handoffAccounts(state, model ?? {
    observation: publicKey(plan.observation.account, "planned observation"),
  });
  if (!progress.proposal) {
    const instruction = buildCreateTargetAuthorityHandoffV1Instruction(CONTROLLER, accounts.create, {
      expectedGateEpoch: state.gate.epoch,
      expectedTargetNonce: state.config.targetNonce,
      expectedCouncilVersion: state.council.version,
      bridgeSourceCommitment: Buffer.from(plan.evidence.sourceEvidenceSha256, "hex"),
      bridgeBuildInputsCommitment: Buffer.from(plan.evidence.buildInputsEvidenceSha256, "hex"),
      bridgePackageCommitment: Buffer.from(plan.evidence.packageEvidenceSha256, "hex"),
      bridgeReleaseManifestCommitment: Buffer.from(plan.evidence.releaseManifestSha256, "hex"),
      planValidUntilSlot: BigInt(plan.planValidUntilSlot),
    });
    return { stage: "handoff-create", instructions: [instruction], signers: [PAYER, SEATS[0]], kmsRole: "seat-0" };
  }
  const proposal = progress.proposal;
  assert(BigInt(state.slot) < proposal.expirySlot, "handoff proposal expired");
  if (proposal.state === CeremonyProposalStateV1.Draft) {
    if (BigInt(state.slot) < proposal.reviewStartSlot) {
      return { pause: "review-window", resumeAtSlot: proposal.reviewStartSlot.toString(), proposalDigest: proposal.proposalDigest.toString("hex") };
    }
    assert(BigInt(state.slot) <= proposal.reviewEndSlot, "handoff proposal review window closed before quorum");
    const index = proposal.approvalCount;
    assert(index >= 0 && index < 3, "handoff approval cursor is invalid");
    const instruction = buildApproveTargetAuthorityHandoffV1Instruction(CONTROLLER, {
      ...accounts.common,
      seatAuthority: SEATS[index],
    }, {
      expectedProposalDigest: proposal.proposalDigest,
      expectedCouncilVersion: state.council.version,
      expectedGateEpoch: state.gate.epoch,
      expectedTargetNonce: state.config.targetNonce,
    });
    return {
      stage: `handoff-approve-${index}`,
      instructions: [instruction],
      signers: [PAYER, SEATS[index]],
      kmsRole: `seat-${index}`,
    };
  }
  if (proposal.state === CeremonyProposalStateV1.CouncilApproved) {
    const instruction = buildQueueTargetAuthorityHandoffV1Instruction(CONTROLLER, accounts.common, {
      expectedProposalDigest: proposal.proposalDigest,
      expectedCouncilVersion: state.council.version,
      expectedGateEpoch: state.gate.epoch,
      expectedTargetNonce: state.config.targetNonce,
    });
    return { stage: "handoff-queue", instructions: [instruction], signers: [PAYER], kmsRole: null };
  }
  if (proposal.state === CeremonyProposalStateV1.Timelocked) {
    if (BigInt(state.slot) < proposal.notBeforeSlot) {
      return { pause: "timelock", resumeAtSlot: proposal.notBeforeSlot.toString(), proposalDigest: proposal.proposalDigest.toString("hex") };
    }
    const instruction = buildAcceptTargetAuthorityCheckedV1Instruction(CONTROLLER, accounts.accept, {
      expectedProposalDigest: proposal.proposalDigest,
      expectedBridgeObservationDigest: observation.observationDigest,
      expectedGateEpoch: state.gate.epoch,
      expectedTargetNonce: state.config.targetNonce,
      envelope: envelope(),
    });
    return {
      stage: "handoff-accept",
      instructions: [...computePrefix(), instruction],
      signers: [PAYER, LEGACY_AUTHORITY],
      kmsRole: "legacy-target-authority",
    };
  }
  if (proposal.state === CeremonyProposalStateV1.Completed) {
    assert(progress.receipt, "completed handoff proposal lacks receipt");
    return { done: true };
  }
  throw new Error(`handoff proposal entered unsupported state ${proposal.state}`);
}

function assertArm(plan) {
  const expected = `execute-handoff:${plan.operationId}`;
  assert.equal(process.env.AMEBA_CEREMONY_ARM?.trim(), expected, `set AMEBA_CEREMONY_ARM=${expected} to execute this exact plan`);
}

async function writeSecureMessage(runDir, stage, bytes) {
  const safeStage = stage.replace(/[^a-z0-9-]/gu, "-");
  const file = fileInRunDir(runDir, `.kms-message-${safeStage}-${sha256Hex(bytes).slice(0, 16)}.bin`);
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(file, 0o600);
  return file;
}

async function signWithKms(transaction, runDir, stage, role) {
  const kms = KMS[role];
  assert(kms, `unknown KMS role ${role}`);
  const pem = await requireSecureRegularFile(requiredEnvironment(kms.pemEnvironment), `${role} KMS public PEM`);
  const message = Buffer.from(transaction.message.serialize());
  const messageSha256 = sha256Hex(message);
  const messageFile = await writeSecureMessage(runDir, stage, message);
  try {
    const result = spawnSync(process.execPath, [
      SIGNER_TOOL,
      "--authority", role,
      "--kms-key-version", kms.resource,
      "--public-key-pem", pem,
      "--message", messageFile,
      "--expected-message-sha256", messageSha256,
    ], {
      shell: false,
      windowsHide: true,
      encoding: "utf8",
      maxBuffer: 64 * 1024,
      timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error || result.status !== 0) {
      throw new Error(`KMS signer failed for ${role} (status=${result.status ?? "none"}, stdoutSha256=${sha256Hex(Buffer.from(result.stdout ?? "", "utf8"))}, stderrSha256=${sha256Hex(Buffer.from(result.stderr ?? "", "utf8"))})`);
    }
    const signed = JSON.parse(result.stdout);
    assertExactKeys(signed, [
      "schema", "authorityRole", "authority", "kmsKeyVersion", "messageBytes",
      "messageSha256", "requiredSignerIndex", "signatureBase64",
    ], `${role} KMS result`);
    assert.equal(signed.schema, "ameba-gcp-kms-ed25519-signature-v1");
    assert.equal(signed.authorityRole, role);
    assert.equal(signed.authority, kms.publicKey.toBase58());
    assert.equal(signed.kmsKeyVersion, kms.resource);
    assert.equal(signed.messageBytes, message.length);
    assert.equal(signed.messageSha256, messageSha256);
    assert(Number.isSafeInteger(signed.requiredSignerIndex) && signed.requiredSignerIndex > 0, `${role} signer index is invalid`);
    const signature = Buffer.from(signed.signatureBase64, "base64");
    assert.equal(signature.length, 64, `${role} KMS signature length changed`);
    assert.equal(signature.toString("base64"), signed.signatureBase64, `${role} KMS signature is noncanonical base64`);
    assert(transaction.message.staticAccountKeys[signed.requiredSignerIndex].equals(kms.publicKey), `${role} KMS signer index changed`);
    transaction.signatures[signed.requiredSignerIndex] = signature;
    return { role, authority: kms.publicKey.toBase58(), messageSha256, requiredSignerIndex: signed.requiredSignerIndex };
  } finally {
    await unlink(messageFile).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

function fullFingerprintSha256(account) {
  return sha256Hex(Buffer.from(JSON.stringify({
    ...accountFingerprint(account),
    lamports: account?.lamports ?? null,
  }), "utf8"));
}

function structuralFingerprintSha256(account) {
  return sha256Hex(Buffer.from(JSON.stringify(accountFingerprint(account)), "utf8"));
}

function negativeStateSnapshot(validated) {
  return {
    programdataRawSha256: sha256Hex(validated.state.targetProgramdata.raw),
    programdataDeployedSlot: validated.state.targetProgramdata.deployedSlot.toString(),
    gateAccountSha256: validated.state.baseFingerprints.protocolGate.dataSha256,
    handoffReceiptAccountSha256: sha256Hex(validated.handoffReceiptAccount.data),
    proofBufferAccountSha256: fullFingerprintSha256(validated.proofBufferAccount),
    spillAccountSha256: fullFingerprintSha256(validated.treasuryAccount),
  };
}

async function loadNegativeProof(inputs, plan) {
  const file = fileInRunDir(inputs.runDir, NEGATIVE_PROOF_FILE);
  let raw;
  try {
    raw = await readFile(file);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  await requireSecureRegularFile(file, "former-authority negative proof");
  const proof = JSON.parse(raw.toString("utf8"));
  assertExactKeys(proof, NEGATIVE_PROOF_KEYS, "former-authority negative proof");
  assert.equal(proof.schema, NEGATIVE_PROOF_SCHEMA);
  assert.equal(proof.operationId, plan.operationId);
  assert.equal(proof.planSha256, sha256Hex(Buffer.from(JSON.stringify(plan), "utf8")));
  assert.equal(proof.mainnetAllowed, false);
  assert.equal(proof.genesisHash, EXPECTED_GENESIS);
  assert.equal(proof.stage, "former-authority-negative");
  assert(typeof proof.signature === "string" && bs58.decode(proof.signature).length === 64, "negative-proof signature is malformed");
  assert(Number.isSafeInteger(proof.finalizedSlot) && proof.finalizedSlot > 0, "negative-proof finalized slot is invalid");
  assertLowerHash(proof.messageSha256, "negative-proof message SHA-256");
  assertLowerHash(proof.wireSha256, "negative-proof wire SHA-256");
  assert.equal(proof.wireBytes, plan.transactionBlueprints.negative.packetBytes);
  assertIncorrectAuthorityFailure(proof.simulationError, proof.simulationLogs, "negative-proof simulation");
  assertIncorrectAuthorityFailure(proof.finalizedError, proof.finalizedLogs, "negative-proof finalized transaction");
  assert.equal(proof.exactErrorName, "IncorrectAuthority");
  assert.equal(proof.proofBuffer, plan.identities.proofBuffer);
  assert.equal(proof.proofBufferRawSha256, plan.negative.proofBufferRawSha256);
  assert.equal(proof.formerAuthority, LEGACY_AUTHORITY.toBase58());
  assert.equal(proof.targetProgram, TARGET.toBase58());
  assert.equal(proof.targetProgramdata, TARGET_PROGRAMDATA.toBase58());
  assert.equal(proof.controllerAuthority, plan.identities.controllerAuthority);
  for (const prefix of ["programdataRawSha256", "programdataDeployedSlot", "gateAccountSha256", "handoffReceiptAccountSha256", "proofBufferAccountSha256", "spillAccountSha256"]) {
    assert.equal(proof[`${prefix}Before`], proof[`${prefix}After`], `negative proof recorded ${prefix} mutation`);
  }
  assert.equal(proof.accountMutationObserved, false, "negative proof recorded account mutation");
  assertLowerHash(proof.journalEntrySha256, "negative-proof journal entry SHA-256");
  return proof;
}

function assertNegativeProofJournal(journal, proof) {
  const entry = journal.entries.find((candidate) => candidate.entrySha256 === proof.journalEntrySha256);
  assert(entry, "former-authority negative proof is not anchored in the hash-chained journal");
  assert.equal(entry.event, "negative-finalized", "former-authority proof journal event changed");
  assert.equal(entry.stage, "former-authority-negative", "former-authority proof journal stage changed");
  assert.equal(entry.signature, proof.signature, "former-authority proof journal signature changed");
  assert.equal(entry.slot, proof.finalizedSlot, "former-authority proof journal slot changed");
}

async function verifyNegativeProofLive(connection, journal, inputs, plan, proof, validated) {
  assertNegativeProofJournal(journal, proof);
  const prepared = journal.entries.find((entry) => (
    entry.event === "negative-prepared"
    && entry.stage === "former-authority-negative"
    && entry.signature === proof.signature
  ));
  assert(prepared, "former-authority negative proof lacks its prepared transaction");
  assertExactKeys(prepared.stateSnapshot, [
    "programdataRawSha256", "programdataDeployedSlot", "gateAccountSha256",
    "handoffReceiptAccountSha256", "proofBufferAccountSha256", "spillAccountSha256",
  ], "negative prepared state snapshot");
  const wire = Buffer.from(prepared.wireBase64, "base64");
  assert.equal(wire.toString("base64"), prepared.wireBase64, "negative prepared wire encoding changed");
  assert.equal(sha256Hex(wire), proof.wireSha256, "negative prepared wire hash changed");
  assert.equal(wire.length, proof.wireBytes, "negative prepared wire length changed");
  assert.deepEqual(prepared.simulation?.error, proof.simulationError, "negative prepared simulation error changed");
  assert.deepEqual(prepared.simulation?.logs ?? [], proof.simulationLogs, "negative prepared simulation logs changed");
  const transaction = VersionedTransaction.deserialize(wire);
  assert.equal(bs58.encode(transaction.signatures[0]), proof.signature, "negative prepared fee-payer signature changed");
  assert.equal(sha256Hex(Buffer.from(transaction.message.serialize())), proof.messageSha256, "negative prepared message changed");
  assert.deepEqual(
    transaction.message.staticAccountKeys
      .slice(0, transaction.message.header.numRequiredSignatures)
      .map((entry) => entry.toBase58()),
    [PAYER.toBase58(), LEGACY_AUTHORITY.toBase58()],
    "negative prepared signer vector changed",
  );
  const decompiled = TransactionMessage.decompile(transaction.message);
  assert.equal(decompiled.instructions.length, 1, "negative prepared transaction acquired a sibling instruction");
  assert.deepEqual(
    instructionManifest(decompiled.instructions[0]),
    instructionManifest(directFormerAuthorityUpgradeInstruction(inputs.proofBuffer)),
    "negative prepared Loader instruction changed",
  );
  const finalized = await finalizedNegativeTransaction(connection, prepared);
  assert(finalized && !finalized.unexpectedSuccess, "former-authority negative transaction is not a finalized expected failure");
  assert.equal(finalized.landed.slot, proof.finalizedSlot, "former-authority negative finalized slot changed");
  assert.deepEqual(finalized.landed.meta.err, proof.finalizedError, "former-authority negative finalized error changed");
  assert.deepEqual(finalized.landed.meta.logMessages ?? [], proof.finalizedLogs, "former-authority negative finalized logs changed");
  const current = negativeStateSnapshot(validated);
  for (const [field, value] of Object.entries(prepared.stateSnapshot)) {
    assert.equal(proof[`${field}After`], value, `negative proof ${field} differs from its prepared prestate`);
  }
  assert.equal(
    prepared.stateSnapshot.gateAccountSha256,
    plan.baseAccountFingerprints.protocolGate.dataSha256,
    "negative proof did not bind the planned bootstrap-frozen gate",
  );
  for (const field of [
    "programdataRawSha256", "programdataDeployedSlot", "handoffReceiptAccountSha256",
  ]) {
    assert.equal(proof[`${field}After`], current[field], `negative proof ${field} no longer matches current finalized state`);
  }
  if (validated.state.gate.status === GateStatusV1.EmergencyFrozen) {
    assert.equal(proof.gateAccountSha256After, current.gateAccountSha256, "negative proof no longer matches the frozen gate");
  }
}

function journalNegativeAttempt(journal) {
  let prepared = null;
  let finalized = null;
  for (const entry of journal.entries) {
    if (entry.stage !== "former-authority-negative") continue;
    if (entry.event === "negative-prepared") {
      prepared = entry;
      finalized = null;
    }
    if (entry.event === "negative-finalized") finalized = entry;
    if (entry.event === "negative-expired") {
      prepared = null;
      finalized = null;
    }
    if (entry.event === "negative-unexpected-success") {
      throw new Error("journal proves the former-authority Loader Upgrade unexpectedly succeeded; stop with the gate frozen");
    }
  }
  return { prepared, finalized };
}

async function finalizedNegativeTransaction(connection, prepared) {
  const landed = await connection.getTransaction(prepared.signature, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  if (!landed) return null;
  assert(landed.meta, "negative finalized transaction metadata is absent");
  assert.equal(landed.transaction.signatures[0], prepared.signature, "negative finalized signature changed");
  const message = Buffer.from(landed.transaction.message.serialize());
  assert.equal(sha256Hex(message), prepared.messageSha256, "negative finalized message changed");
  if (landed.meta.err === null) return { unexpectedSuccess: true, landed, message };
  assertIncorrectAuthorityFailure(landed.meta.err, landed.meta.logMessages, "negative finalized transaction");
  return { unexpectedSuccess: false, landed, message };
}

async function pollNegativeFinalized(connection, journal, prepared) {
  for (;;) {
    const result = await finalizedNegativeTransaction(connection, prepared);
    if (result) {
      if (result.unexpectedSuccess) {
        await journal.append("negative-unexpected-success", {
          stage: "former-authority-negative",
          signature: prepared.signature,
          slot: result.landed.slot,
        });
        throw new Error("former-authority exact-artifact Loader Upgrade unexpectedly succeeded; keep the gate frozen and stop");
      }
      return result;
    }
    const blockHeight = await connection.getBlockHeight("finalized");
    if (blockHeight > prepared.lastValidBlockHeight) {
      const statuses = await connection.getSignatureStatuses([prepared.signature], { searchTransactionHistory: true });
      assert.equal(statuses.value.length, 1, "negative expiry status response changed");
      if (statuses.value[0] !== null) {
        await new Promise((resolve) => setTimeout(resolve, FINALIZED_STATUS_POLL_INTERVAL_MS));
        continue;
      }
      await journal.append("negative-expired", {
        stage: "former-authority-negative",
        signature: prepared.signature,
        observedBlockHeight: blockHeight,
      });
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, FINALIZED_STATUS_POLL_INTERVAL_MS));
  }
}

async function writeNegativeProof(inputs, plan, journal, prepared, simulation, finalized, before, after) {
  assert.deepEqual(after, before, "former-authority failed transaction changed protected accounts");
  let terminalEntry = journal.entries.findLast((entry) => (
    entry.event === "negative-finalized"
    && entry.stage === "former-authority-negative"
    && entry.signature === prepared.signature
  ));
  if (!terminalEntry) {
    terminalEntry = await journal.append("negative-finalized", {
      stage: "former-authority-negative",
      signature: prepared.signature,
      slot: finalized.landed.slot,
      errorSha256: sha256Hex(Buffer.from(JSON.stringify(finalized.landed.meta.err), "utf8")),
      logsSha256: sha256Hex(Buffer.from(JSON.stringify(finalized.landed.meta.logMessages ?? []), "utf8")),
    });
  } else {
    assert.equal(terminalEntry.slot, finalized.landed.slot, "journaled negative finalization slot changed");
    assert.equal(terminalEntry.errorSha256, sha256Hex(Buffer.from(JSON.stringify(finalized.landed.meta.err), "utf8")), "journaled negative error changed");
    assert.equal(terminalEntry.logsSha256, sha256Hex(Buffer.from(JSON.stringify(finalized.landed.meta.logMessages ?? []), "utf8")), "journaled negative logs changed");
  }
  const proof = {
    schema: NEGATIVE_PROOF_SCHEMA,
    operationId: plan.operationId,
    planSha256: sha256Hex(Buffer.from(JSON.stringify(plan), "utf8")),
    mainnetAllowed: false,
    genesisHash: EXPECTED_GENESIS,
    stage: "former-authority-negative",
    signature: prepared.signature,
    finalizedSlot: finalized.landed.slot,
    messageSha256: prepared.messageSha256,
    wireSha256: prepared.wireSha256,
    wireBytes: prepared.wireBytes,
    simulationError: simulation.error,
    simulationLogs: simulation.logs,
    finalizedError: finalized.landed.meta.err,
    finalizedLogs: finalized.landed.meta.logMessages ?? [],
    exactErrorName: "IncorrectAuthority",
    proofBuffer: plan.identities.proofBuffer,
    proofBufferRawSha256: plan.negative.proofBufferRawSha256,
    formerAuthority: LEGACY_AUTHORITY.toBase58(),
    targetProgram: TARGET.toBase58(),
    targetProgramdata: TARGET_PROGRAMDATA.toBase58(),
    controllerAuthority: plan.identities.controllerAuthority,
    programdataRawSha256Before: before.programdataRawSha256,
    programdataRawSha256After: after.programdataRawSha256,
    programdataDeployedSlotBefore: before.programdataDeployedSlot,
    programdataDeployedSlotAfter: after.programdataDeployedSlot,
    gateAccountSha256Before: before.gateAccountSha256,
    gateAccountSha256After: after.gateAccountSha256,
    handoffReceiptAccountSha256Before: before.handoffReceiptAccountSha256,
    handoffReceiptAccountSha256After: after.handoffReceiptAccountSha256,
    proofBufferAccountSha256Before: before.proofBufferAccountSha256,
    proofBufferAccountSha256After: after.proofBufferAccountSha256,
    spillAccountSha256Before: before.spillAccountSha256,
    spillAccountSha256After: after.spillAccountSha256,
    accountMutationObserved: false,
    journalEntrySha256: terminalEntry.entrySha256,
  };
  await writeJsonOnce(fileInRunDir(inputs.runDir, NEGATIVE_PROOF_FILE), proof);
  return proof;
}

async function executeNegativeProof(connection, journal, inputs, plan, payer, initialValidated) {
  const existingProof = await loadNegativeProof(inputs, plan);
  if (existingProof) return existingProof;
  const priorAttempt = journalNegativeAttempt(journal);
  const prior = priorAttempt.prepared;
  if (prior) {
    const finalized = await pollNegativeFinalized(connection, journal, prior);
    if (finalized) {
      const afterValidated = await readActivationLiveState(connection, inputs, plan, finalized.landed.slot);
      const before = prior.stateSnapshot;
      const after = negativeStateSnapshot(afterValidated);
      return writeNegativeProof(inputs, plan, journal, prior, prior.simulation, finalized, before, after);
    }
    throw new Error("former-authority negative transaction expired without landing; stop and create a new activation plan/operation");
  }
  const validated = prior ? await readActivationLiveState(connection, inputs, plan) : initialValidated;
  const action = nextActivationAction(validated, null, null, plan);
  assert.equal(action.stage, "former-authority-negative", "former-authority negative proof is no longer the next action");
  const blueprint = assertActivationStageBlueprint(plan, action);
  const latest = await connection.getLatestBlockhashAndContext({ commitment: "finalized", minContextSlot: validated.state.slot });
  assert(latest.context.slot >= validated.state.slot, "negative blockhash predates its finalized prestate");
  const message = new TransactionMessage({ payerKey: PAYER, recentBlockhash: latest.value.blockhash, instructions: action.instructions }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  await journal.append("decoded-action-displayed", {
    stage: action.stage,
    expectedSigners: action.signers.map((entry) => entry.toBase58()),
    instructions: action.instructions.map(instructionManifest),
    expectedFailure: "IncorrectAuthority",
  });
  process.stdout.write(`${JSON.stringify({
    schema: "ameba-governance-devnet-decoded-action-v1",
    operationId: plan.operationId,
    stage: action.stage,
    expectedSigners: action.signers.map((entry) => entry.toBase58()),
    instructions: action.instructions.map(instructionManifest),
    expectedFailure: "IncorrectAuthority",
  }, null, 2)}\n`);
  transaction.sign([payer]);
  const kmsEvidence = await signWithKms(transaction, inputs.runDir, action.stage, "legacy-target-authority");
  const wire = Buffer.from(transaction.serialize());
  assert.equal(wire.length, blueprint.packetBytes, "negative signed packet length changed");
  const simulationResult = await connection.simulateTransaction(transaction, {
    commitment: "processed",
    sigVerify: true,
    replaceRecentBlockhash: false,
    minContextSlot: latest.context.slot,
  });
  assertIncorrectAuthorityFailure(simulationResult.value.err, simulationResult.value.logs, "former-authority simulation");
  const simulation = { error: simulationResult.value.err, logs: simulationResult.value.logs ?? [] };
  await journal.append("negative-simulation-passed", {
    stage: action.stage,
    expectedFailure: "IncorrectAuthority",
    errorSha256: sha256Hex(Buffer.from(JSON.stringify(simulation.error), "utf8")),
    logsSha256: sha256Hex(Buffer.from(JSON.stringify(simulation.logs), "utf8")),
    kmsEvidence,
  });
  const beforeValidated = await readActivationLiveState(connection, inputs, plan, latest.context.slot);
  const before = negativeStateSnapshot(beforeValidated);
  const blockhashValidity = await connection.isBlockhashValid(latest.value.blockhash, {
    commitment: "finalized",
    minContextSlot: beforeValidated.state.slot,
  });
  assert(blockhashValidity.context.slot >= beforeValidated.state.slot, "negative blockhash validation predates its pre-submit state");
  assert.equal(blockhashValidity.value, true, "negative blockhash expired before submission; rerun the exact armed operation");
  const signature = bs58.encode(transaction.signatures[0]);
  const prepared = await journal.append("negative-prepared", {
    stage: action.stage,
    signature,
    blockhash: latest.value.blockhash,
    lastValidBlockHeight: latest.value.lastValidBlockHeight,
    minContextSlot: beforeValidated.state.slot,
    expectedSigners: action.signers.map((entry) => entry.toBase58()),
    messageSha256: sha256Hex(Buffer.from(message.serialize())),
    wireSha256: sha256Hex(wire),
    wireBytes: wire.length,
    wireBase64: wire.toString("base64"),
    simulation,
    stateSnapshot: before,
  });
  let returnedSignature;
  try {
    returnedSignature = await connection.sendRawTransaction(wire, {
      skipPreflight: true,
      maxRetries: 0,
      minContextSlot: beforeValidated.state.slot,
    });
  } catch (error) {
    if (error instanceof RpcBackoffExit) throw error;
    await journal.append("negative-submission-unknown", {
      stage: action.stage,
      signature,
      errorSha256: sha256Hex(Buffer.from(String(error?.message ?? error), "utf8")),
    });
    throw new Error(`former-authority negative submission outcome is unknown; reconcile ${signature}`);
  }
  assert.equal(returnedSignature, signature, "negative RPC returned a different signature");
  await journal.append("negative-submitted", { stage: action.stage, signature });
  const finalized = await pollNegativeFinalized(connection, journal, prepared);
  assert(finalized, "negative transaction expired before landing; stop and create a new activation plan/operation");
  const afterValidated = await readActivationLiveState(connection, inputs, plan, finalized.landed.slot);
  const after = negativeStateSnapshot(afterValidated);
  return writeNegativeProof(inputs, plan, journal, prepared, simulation, finalized, before, after);
}

function proofBufferClosePrestate(validated, inputs) {
  assert(validated.proofBufferAccount, "proof-buffer close prestate is missing the buffer");
  const parsed = parseBufferAccount(validated.proofBufferAccount, inputs);
  return {
    programdataRawSha256: sha256Hex(validated.state.targetProgramdata.raw),
    programdataDeployedSlot: validated.state.targetProgramdata.deployedSlot.toString(),
    gateAccountSha256: validated.state.baseFingerprints.protocolGate.dataSha256,
    handoffReceiptAccountSha256: sha256Hex(validated.handoffReceiptAccount.data),
    proofBufferRawSha256: sha256Hex(parsed.raw),
    proofBufferAccountSha256: fullFingerprintSha256(validated.proofBufferAccount),
    proofBufferLamports: validated.proofBufferAccount.lamports,
    treasuryAccountSha256: fullFingerprintSha256(validated.treasuryAccount),
    treasuryLamports: validated.treasuryAccount.lamports,
  };
}

function proofBufferClosePoststate(validated) {
  assert.equal(validated.proofBufferAccount, null, "proof-buffer Close did not remove the buffer account");
  return {
    programdataRawSha256: sha256Hex(validated.state.targetProgramdata.raw),
    programdataDeployedSlot: validated.state.targetProgramdata.deployedSlot.toString(),
    gateAccountSha256: validated.state.baseFingerprints.protocolGate.dataSha256,
    handoffReceiptAccountSha256: sha256Hex(validated.handoffReceiptAccount.data),
    treasuryAccountSha256: fullFingerprintSha256(validated.treasuryAccount),
    treasuryLamports: validated.treasuryAccount.lamports,
  };
}

function classifyProofBufferCloseRecoveryState(before, observation) {
  assert(Number.isSafeInteger(observation.slot) && observation.slot > 0, "proof-buffer Close recovery slot is invalid");
  assert.equal(typeof observation.proofBufferPresent, "boolean", "proof-buffer Close recovery presence flag is invalid");
  if (observation.proofBufferPresent) {
    assert.deepEqual(
      observation.state,
      before,
      "proof-buffer Close expired-state probe did not observe the exact prepared prestate",
    );
    return { kind: "unchanged-prestate", slot: observation.slot };
  }
  const after = observation.state;
  for (const field of ["programdataRawSha256", "programdataDeployedSlot", "gateAccountSha256", "handoffReceiptAccountSha256"]) {
    assert.equal(after[field], before[field], `proof-buffer Close recovery changed ${field}`);
  }
  assert.equal(
    after.reconstructedTreasuryPrestateSha256,
    before.treasuryAccountSha256,
    "proof-buffer Close recovery treasury changed outside the exact lamport transfer",
  );
  assert.equal(
    after.treasuryLamports - before.treasuryLamports,
    before.proofBufferLamports,
    "proof-buffer Close recovery treasury delta is not the exact closed-buffer balance",
  );
  return { kind: "landed-poststate", slot: observation.slot };
}

async function observeProofBufferCloseRecoveryState(connection, prepared, inputs, plan, minContextSlot) {
  const proofBufferRead = await connection.getAccountInfoAndContext(
    inputs.proofBuffer,
    finalizedConfig(minContextSlot),
  );
  assert(
    proofBufferRead.context.slot >= minContextSlot,
    "proof-buffer Close recovery buffer read predates the finalized expiry boundary",
  );
  const bufferVacant = proofBufferRead.value === null || (
    proofBufferRead.value.owner.equals(SystemProgram.programId)
    && proofBufferRead.value.data.length === 0
  );
  const recoveryPoststateMarker = bufferVacant
    ? { receipt: { finalizedSlot: proofBufferRead.context.slot }, recoveryProbe: true }
    : null;
  const validated = await readActivationLiveState(
    connection,
    inputs,
    plan,
    proofBufferRead.context.slot,
    recoveryPoststateMarker,
  );
  assert(
    validated.state.slot >= proofBufferRead.context.slot,
    "proof-buffer Close recovery state predates its buffer-presence observation",
  );
  if (!bufferVacant) {
    return classifyProofBufferCloseRecoveryState(prepared.stateSnapshot, {
      slot: validated.state.slot,
      proofBufferPresent: true,
      state: proofBufferClosePrestate(validated, inputs),
    });
  }
  const after = proofBufferClosePoststate(validated);
  const reconstructedTreasuryPrestateSha256 = sha256Hex(Buffer.from(JSON.stringify({
    ...accountFingerprint(validated.treasuryAccount),
    lamports: prepared.stateSnapshot.treasuryLamports,
  }), "utf8"));
  return classifyProofBufferCloseRecoveryState(prepared.stateSnapshot, {
    slot: validated.state.slot,
    proofBufferPresent: false,
    state: { ...after, reconstructedTreasuryPrestateSha256 },
  });
}

async function loadProofBufferCloseReceipt(inputs, plan, negativeProof) {
  const file = fileInRunDir(inputs.runDir, PROOF_BUFFER_CLOSE_RECEIPT_FILE);
  let bytes;
  try {
    bytes = await readFile(file);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  assert(negativeProof, "proof-buffer close receipt exists without the former-authority negative proof");
  await requireSecureRegularFile(file, "former-authority proof-buffer close receipt");
  const receipt = JSON.parse(bytes.toString("utf8"));
  assertExactKeys(receipt, PROOF_BUFFER_CLOSE_RECEIPT_KEYS, "former-authority proof-buffer close receipt");
  assert.equal(receipt.schema, PROOF_BUFFER_CLOSE_RECEIPT_SCHEMA);
  assert.equal(receipt.operationId, plan.operationId);
  assert.equal(receipt.planSha256, sha256Hex(Buffer.from(JSON.stringify(plan), "utf8")));
  assert.equal(receipt.mainnetAllowed, false);
  assert.equal(receipt.genesisHash, EXPECTED_GENESIS);
  assert.equal(receipt.stage, "former-authority-proof-buffer-close");
  assert.equal(receipt.proofBuffer, plan.identities.proofBuffer);
  assert.equal(receipt.proofBufferReceiptSha256, inputs.proofReceiptSha256);
  assert.equal(receipt.negativeProof, NEGATIVE_PROOF_FILE);
  assert.equal(
    receipt.negativeProofSha256,
    sha256Hex(await readFile(fileInRunDir(inputs.runDir, NEGATIVE_PROOF_FILE))),
    "proof-buffer close receipt negative-proof hash changed",
  );
  assert.equal(receipt.negativeFailureSignature, negativeProof.signature);
  assert.equal(receipt.loader, BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58());
  assert.equal(receipt.closeInstructionDataHex, LOADER_CLOSE_DATA.toString("hex"));
  assert.equal(receipt.formerAuthority, LEGACY_AUTHORITY.toBase58());
  assert.equal(receipt.feePayer, PAYER.toBase58());
  assert.equal(receipt.spillTreasury, TREASURY.toBase58());
  assertLowerHash(receipt.messageSha256, "proof-buffer close message SHA-256");
  assertLowerHash(receipt.wireSha256, "proof-buffer close wire SHA-256");
  assert.equal(receipt.wireBytes, plan.transactionBlueprints.close.packetBytes);
  assert(typeof receipt.signature === "string" && bs58.decode(receipt.signature).length === 64, "proof-buffer close signature is malformed");
  assert(Number.isSafeInteger(receipt.finalizedSlot) && receipt.finalizedSlot > 0, "proof-buffer close finalized slot is invalid");
  for (const field of ["proofBufferLamports", "treasuryLamportsBefore", "treasuryLamportsAfter", "treasuryLamportDelta"]) {
    assert(Number.isSafeInteger(receipt[field]) && receipt[field] >= 0, `${field} is invalid`);
  }
  assert.equal(receipt.proofBufferLamports, plan.negative.proofBufferLamports);
  assert.equal(receipt.treasuryLamportsBefore, plan.negative.spillTreasuryLamportsBeforeClose);
  assert.equal(receipt.treasuryLamportDelta, receipt.proofBufferLamports);
  assert.equal(receipt.treasuryLamportsAfter - receipt.treasuryLamportsBefore, receipt.treasuryLamportDelta);
  assertLowerHash(receipt.treasuryAccountSha256Before, "proof-buffer close treasury prestate SHA-256");
  assertLowerHash(receipt.treasuryAccountSha256After, "proof-buffer close treasury poststate SHA-256");
  assert.equal(receipt.treasuryAccountSha256Before, negativeProof.spillAccountSha256After, "proof-buffer Close treasury prestate differs from the negative proof");
  assert.equal(receipt.proofBufferRawSha256Before, plan.negative.proofBufferRawSha256);
  assert.equal(receipt.proofBufferAccountSha256Before, negativeProof.proofBufferAccountSha256After);
  assert.equal(receipt.proofBufferPoststate, null);
  assert.equal(receipt.targetProgram, TARGET.toBase58());
  assert.equal(receipt.targetProgramdata, TARGET_PROGRAMDATA.toBase58());
  assert.equal(receipt.controllerAuthority, plan.identities.controllerAuthority);
  for (const prefix of ["programdataRawSha256", "programdataDeployedSlot", "gateAccountSha256", "handoffReceiptAccountSha256"]) {
    assert.equal(receipt[`${prefix}Before`], receipt[`${prefix}After`], `proof-buffer Close changed ${prefix}`);
  }
  assert.equal(receipt.targetMutationObserved, false);
  assertLowerHash(receipt.journalEntrySha256, "proof-buffer close journal entry SHA-256");
  assert.equal(receipt.receiptSha256, proofBufferCloseReceiptSha256(receipt), "proof-buffer close semantic receipt hash changed");
  return { receipt, sha256: sha256Hex(bytes), file };
}

function proofBufferCloseAttempt(journal) {
  let prepared = null;
  let finalized = null;
  for (const entry of journal.entries) {
    if (entry.stage !== "former-authority-proof-buffer-close") continue;
    if (entry.event === "proof-buffer-close-prepared") {
      prepared = entry;
      finalized = null;
    }
    if (entry.event === "proof-buffer-close-finalized") finalized = entry;
    if (entry.event === "proof-buffer-close-expired") {
      prepared = null;
      finalized = null;
    }
    if (entry.event === "proof-buffer-close-failed") {
      throw new Error("proof-buffer Close finalized with an error; keep the gate frozen and stop");
    }
  }
  return { prepared, finalized };
}

function assertProofBufferClosePrepared(prepared, inputs, plan) {
  assert(prepared, "proof-buffer Close lacks its prepared transaction");
  assert(
    Number.isSafeInteger(prepared.minContextSlot) && prepared.minContextSlot > 0,
    "proof-buffer Close prepared minimum context slot is invalid",
  );
  assert(
    Number.isSafeInteger(prepared.lastValidBlockHeight) && prepared.lastValidBlockHeight > 0,
    "proof-buffer Close prepared last-valid block height is invalid",
  );
  assert(typeof prepared.blockhash === "string" && bs58.decode(prepared.blockhash).length === 32, "proof-buffer Close prepared blockhash is invalid");
  assert.deepEqual(
    prepared.expectedSigners,
    [PAYER.toBase58(), LEGACY_AUTHORITY.toBase58()],
    "proof-buffer Close prepared signer commitment changed",
  );
  assertExactKeys(prepared.stateSnapshot, [
    "programdataRawSha256", "programdataDeployedSlot", "gateAccountSha256",
    "handoffReceiptAccountSha256", "proofBufferRawSha256", "proofBufferAccountSha256",
    "proofBufferLamports", "treasuryAccountSha256", "treasuryLamports",
  ], "proof-buffer Close prepared state snapshot");
  const wire = Buffer.from(prepared.wireBase64, "base64");
  assert.equal(wire.toString("base64"), prepared.wireBase64, "proof-buffer Close wire encoding changed");
  assert.equal(sha256Hex(wire), prepared.wireSha256, "proof-buffer Close wire hash changed");
  assert.equal(wire.length, plan.transactionBlueprints.close.packetBytes, "proof-buffer Close packet length changed");
  const transaction = VersionedTransaction.deserialize(wire);
  assert.equal(transaction.message.recentBlockhash, prepared.blockhash, "proof-buffer Close message blockhash changed");
  assert.equal(bs58.encode(transaction.signatures[0]), prepared.signature, "proof-buffer Close fee-payer signature changed");
  assert.equal(sha256Hex(Buffer.from(transaction.message.serialize())), prepared.messageSha256, "proof-buffer Close message changed");
  assert.deepEqual(
    transaction.message.staticAccountKeys
      .slice(0, transaction.message.header.numRequiredSignatures)
      .map((entry) => entry.toBase58()),
    [PAYER.toBase58(), LEGACY_AUTHORITY.toBase58()],
    "proof-buffer Close signer vector changed",
  );
  const decompiled = TransactionMessage.decompile(transaction.message);
  assert.equal(decompiled.instructions.length, 1, "proof-buffer Close acquired a sibling instruction");
  assert.deepEqual(
    instructionManifest(decompiled.instructions[0]),
    instructionManifest(directFormerAuthorityCloseBufferInstruction(inputs.proofBuffer)),
    "proof-buffer Loader Close instruction changed",
  );
  return { wire, transaction };
}

async function finalizedProofBufferCloseTransaction(connection, prepared, inputs, plan) {
  const landed = await connection.getTransaction(prepared.signature, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  if (!landed) return null;
  assert(landed.meta, "proof-buffer Close finalized metadata is absent");
  assert.equal(landed.transaction.signatures[0], prepared.signature, "proof-buffer Close finalized signature changed");
  assert.equal(
    sha256Hex(Buffer.from(landed.transaction.message.serialize())),
    prepared.messageSha256,
    "proof-buffer Close finalized message changed",
  );
  assertProofBufferClosePrepared(prepared, inputs, plan);
  return landed;
}

async function pollProofBufferCloseFinalized(connection, journal, prepared, inputs, plan, testHooks = null) {
  const validatePrepared = testHooks?.validatePrepared
    ?? ((currentPrepared) => assertProofBufferClosePrepared(currentPrepared, inputs, plan));
  validatePrepared(prepared);
  const finalizedTransaction = testHooks?.finalizedTransaction
    ?? ((currentConnection, currentPrepared) => finalizedProofBufferCloseTransaction(
      currentConnection,
      currentPrepared,
      inputs,
      plan,
    ));
  const observeRecoveryState = testHooks?.observeRecoveryState
    ?? ((currentConnection, currentPrepared, minContextSlot) => observeProofBufferCloseRecoveryState(
      currentConnection,
      currentPrepared,
      inputs,
      plan,
      minContextSlot,
    ));
  const wait = testHooks?.wait
    ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  for (;;) {
    const landed = await finalizedTransaction(connection, prepared);
    if (landed) {
      if (landed.meta.err !== null) {
        await journal.append("proof-buffer-close-failed", {
          stage: "former-authority-proof-buffer-close",
          signature: prepared.signature,
          slot: landed.slot,
          errorSha256: sha256Hex(Buffer.from(JSON.stringify(landed.meta.err), "utf8")),
        });
        throw new Error("proof-buffer Close finalized with an error; keep the gate frozen and stop");
      }
      return landed;
    }
    const blockHeight = await connection.getBlockHeight("finalized");
    if (blockHeight > prepared.lastValidBlockHeight) {
      const statuses = await connection.getSignatureStatuses([prepared.signature], { searchTransactionHistory: true });
      assert.equal(statuses.value.length, 1, "proof-buffer Close expiry status response changed");
      if (statuses.value[0]?.err) {
        await journal.append("proof-buffer-close-failed", {
          stage: "former-authority-proof-buffer-close",
          signature: prepared.signature,
          errorSha256: sha256Hex(Buffer.from(JSON.stringify(statuses.value[0].err), "utf8")),
        });
        throw new Error("proof-buffer Close finalized with an error; keep the gate frozen and stop");
      }
      if (statuses.value[0] !== null) {
        await wait(FINALIZED_STATUS_POLL_INTERVAL_MS);
        continue;
      }
      const exactLanded = await finalizedTransaction(connection, prepared);
      if (exactLanded) {
        if (exactLanded.meta.err !== null) {
          await journal.append("proof-buffer-close-failed", {
            stage: "former-authority-proof-buffer-close",
            signature: prepared.signature,
            slot: exactLanded.slot,
            errorSha256: sha256Hex(Buffer.from(JSON.stringify(exactLanded.meta.err), "utf8")),
          });
          throw new Error("proof-buffer Close finalized with an error; keep the gate frozen and stop");
        }
        return exactLanded;
      }
      const finalizedProofSlot = await connection.getSlot("finalized");
      assert(
        Number.isSafeInteger(finalizedProofSlot) && finalizedProofSlot > 0,
        "proof-buffer Close finalized expiry slot is invalid",
      );
      assert(
        finalizedProofSlot >= prepared.minContextSlot,
        "proof-buffer Close finalized expiry slot predates the prepared minimum context",
      );
      const recovery = await observeRecoveryState(connection, prepared, finalizedProofSlot);
      assert(
        Number.isSafeInteger(recovery.slot) && recovery.slot >= finalizedProofSlot,
        "proof-buffer Close recovery probe predates the finalized expiry boundary",
      );
      if (recovery.kind === "landed-poststate") {
        const alreadyRecorded = journal.entries.some((entry) => (
          entry.event === "proof-buffer-close-poststate-history-pending"
          && entry.stage === "former-authority-proof-buffer-close"
          && entry.signature === prepared.signature
        ));
        if (!alreadyRecorded) {
          await journal.append("proof-buffer-close-poststate-history-pending", {
            stage: "former-authority-proof-buffer-close",
            signature: prepared.signature,
            observedBlockHeight: blockHeight,
            finalizedProofSlot,
            poststateProofSlot: recovery.slot,
          });
        }
        await wait(FINALIZED_STATUS_POLL_INTERVAL_MS);
        continue;
      }
      assert.equal(recovery.kind, "unchanged-prestate", "proof-buffer Close recovery classification changed");
      await journal.append("proof-buffer-close-expired", {
        stage: "former-authority-proof-buffer-close",
        signature: prepared.signature,
        observedBlockHeight: blockHeight,
        finalizedProofSlot,
        prestateProofSlot: recovery.slot,
      });
      return null;
    }
    await wait(FINALIZED_STATUS_POLL_INTERVAL_MS);
  }
}

async function selfTestProofBufferCloseRecovery() {
  const hash = (byte) => byte.repeat(64);
  const before = {
    programdataRawSha256: hash("1"),
    programdataDeployedSlot: "123",
    gateAccountSha256: hash("2"),
    handoffReceiptAccountSha256: hash("3"),
    proofBufferRawSha256: hash("4"),
    proofBufferAccountSha256: hash("5"),
    proofBufferLamports: 700,
    treasuryAccountSha256: hash("6"),
    treasuryLamports: 1_000,
  };
  assert.deepEqual(
    classifyProofBufferCloseRecoveryState(before, {
      slot: 101,
      proofBufferPresent: true,
      state: structuredClone(before),
    }),
    { kind: "unchanged-prestate", slot: 101 },
  );
  const landedState = {
    programdataRawSha256: before.programdataRawSha256,
    programdataDeployedSlot: before.programdataDeployedSlot,
    gateAccountSha256: before.gateAccountSha256,
    handoffReceiptAccountSha256: before.handoffReceiptAccountSha256,
    treasuryAccountSha256: hash("7"),
    treasuryLamports: 1_700,
    reconstructedTreasuryPrestateSha256: before.treasuryAccountSha256,
  };
  assert.deepEqual(
    classifyProofBufferCloseRecoveryState(before, {
      slot: 102,
      proofBufferPresent: false,
      state: landedState,
    }),
    { kind: "landed-poststate", slot: 102 },
  );
  assert.throws(
    () => classifyProofBufferCloseRecoveryState(before, {
      slot: 102,
      proofBufferPresent: false,
      state: { ...landedState, gateAccountSha256: hash("8") },
    }),
    /changed gateAccountSha256/u,
  );

  const testBuffer = new PublicKey("11111111111111111111111111111112");
  const preparedBlockhash = bs58.encode(Buffer.alloc(32, 9));
  const preparedTransaction = new VersionedTransaction(new TransactionMessage({
    payerKey: PAYER,
    recentBlockhash: preparedBlockhash,
    instructions: [directFormerAuthorityCloseBufferInstruction(testBuffer)],
  }).compileToV0Message());
  preparedTransaction.signatures[0].set(Buffer.alloc(64, 1));
  preparedTransaction.signatures[1].set(Buffer.alloc(64, 2));
  const preparedWire = Buffer.from(preparedTransaction.serialize());
  const exactPrepared = {
    signature: bs58.encode(preparedTransaction.signatures[0]),
    blockhash: preparedBlockhash,
    lastValidBlockHeight: 1,
    minContextSlot: 100,
    expectedSigners: [PAYER.toBase58(), LEGACY_AUTHORITY.toBase58()],
    messageSha256: sha256Hex(Buffer.from(preparedTransaction.message.serialize())),
    wireSha256: sha256Hex(preparedWire),
    wireBytes: preparedWire.length,
    wireBase64: preparedWire.toString("base64"),
    stateSnapshot: before,
  };
  const preparedInputs = { proofBuffer: testBuffer };
  const preparedPlan = { transactionBlueprints: { close: { packetBytes: preparedWire.length } } };
  assert.doesNotThrow(() => assertProofBufferClosePrepared(exactPrepared, preparedInputs, preparedPlan));
  const tamperedPreparedJournal = { entries: [], async append(event, fields) { this.entries.push({ event, ...fields }); } };
  await assert.rejects(
    pollProofBufferCloseFinalized(
      new Proxy({}, { get() { throw new Error("tampered prepared state reached RPC"); } }),
      tamperedPreparedJournal,
      { ...exactPrepared, minContextSlot: 0 },
      preparedInputs,
      preparedPlan,
    ),
    /prepared minimum context slot is invalid/u,
  );
  assert.equal(tamperedPreparedJournal.entries.length, 0, "tampered proof-buffer Close prepared state emitted terminal evidence");

  const prepared = {
    signature: "proof-buffer-close-self-test",
    blockhash: bs58.encode(Buffer.alloc(32, 9)),
    lastValidBlockHeight: 1,
    minContextSlot: 100,
    expectedSigners: [PAYER.toBase58(), LEGACY_AUTHORITY.toBase58()],
    stateSnapshot: before,
  };
  const makeJournal = () => ({
    entries: [],
    async append(event, fields) {
      const entry = { event, ...fields };
      this.entries.push(entry);
      return entry;
    },
  });
  const makeConnection = () => ({
    async getBlockHeight() { return 2; },
    async getSignatureStatuses() { return { value: [null] }; },
    async getSlot() { return 101; },
  });

  const expiredJournal = makeJournal();
  const expired = await pollProofBufferCloseFinalized(
    makeConnection(),
    expiredJournal,
    prepared,
    {},
    {},
    {
      validatePrepared() {},
      async finalizedTransaction() { return null; },
      async observeRecoveryState(_connection, _prepared, minimumSlot) {
        return { kind: "unchanged-prestate", slot: minimumSlot };
      },
      async wait() {},
    },
  );
  assert.equal(expired, null);
  assert.equal(expiredJournal.entries.filter((entry) => entry.event === "proof-buffer-close-expired").length, 1);

  const landedJournal = makeJournal();
  let transactionLookups = 0;
  let waits = 0;
  const landed = await pollProofBufferCloseFinalized(
    makeConnection(),
    landedJournal,
    prepared,
    {},
    {},
    {
      validatePrepared() {},
      async finalizedTransaction() {
        transactionLookups += 1;
        return transactionLookups >= 3 ? { meta: { err: null }, slot: 103 } : null;
      },
      async observeRecoveryState(_connection, _prepared, minimumSlot) {
        return { kind: "landed-poststate", slot: minimumSlot + 1 };
      },
      async wait() { waits += 1; },
    },
  );
  assert.equal(landed.slot, 103);
  assert.equal(transactionLookups, 3, "proof-buffer Close did not recheck exact finalized history");
  assert.equal(waits, 1, "proof-buffer Close history-pending recovery did not pace its next lookup");
  assert.equal(landedJournal.entries.filter((entry) => entry.event === "proof-buffer-close-poststate-history-pending").length, 1);
  assert.equal(landedJournal.entries.some((entry) => entry.event === "proof-buffer-close-expired"), false);

  const staleJournal = makeJournal();
  await assert.rejects(
    pollProofBufferCloseFinalized(
      makeConnection(),
      staleJournal,
      prepared,
      {},
      {},
      {
        validatePrepared() {},
        async finalizedTransaction() { return null; },
        async observeRecoveryState(_connection, _prepared, minimumSlot) {
          return { kind: "unchanged-prestate", slot: minimumSlot - 1 };
        },
        async wait() {},
      },
    ),
    /predates the finalized expiry boundary/u,
  );
  assert.equal(staleJournal.entries.some((entry) => entry.event === "proof-buffer-close-expired"), false);

  const staleFinalizedSlotJournal = makeJournal();
  let staleFinalizedSlotProbeCalls = 0;
  await assert.rejects(
    pollProofBufferCloseFinalized(
      { ...makeConnection(), async getSlot() { return 99; } },
      staleFinalizedSlotJournal,
      prepared,
      {},
      {},
      {
        validatePrepared() {},
        async finalizedTransaction() { return null; },
        async observeRecoveryState() {
          staleFinalizedSlotProbeCalls += 1;
          return { kind: "unchanged-prestate", slot: 100 };
        },
        async wait() {},
      },
    ),
    /finalized expiry slot predates the prepared minimum context/u,
  );
  assert.equal(staleFinalizedSlotProbeCalls, 0, "stale finalized slot reached the proof-buffer Close state probe");
  assert.equal(staleFinalizedSlotJournal.entries.length, 0, "stale finalized slot emitted proof-buffer Close terminal evidence");

  const driftJournal = makeJournal();
  await assert.rejects(
    pollProofBufferCloseFinalized(
      makeConnection(),
      driftJournal,
      prepared,
      {},
      {},
      {
        validatePrepared() {},
        async finalizedTransaction() { return null; },
        async observeRecoveryState() { throw new Error("malformed proof-buffer Close recovery drift"); },
        async wait() {},
      },
    ),
    /malformed proof-buffer Close recovery drift/u,
  );
  assert.equal(driftJournal.entries.some((entry) => entry.event === "proof-buffer-close-expired"), false);
  return {
    unchangedPrestateExpires: true,
    landedPoststateRetainsPreparedHistory: true,
    staleObservationRejected: true,
    staleFinalizedSlotRejected: true,
    tamperedPreparedRejected: true,
    malformedDriftRejected: true,
  };
}

async function writeProofBufferCloseReceipt(inputs, plan, journal, negativeProof, prepared, landed, afterValidated) {
  const before = prepared.stateSnapshot;
  const after = proofBufferClosePoststate(afterValidated);
  for (const field of ["programdataRawSha256", "programdataDeployedSlot", "gateAccountSha256", "handoffReceiptAccountSha256"]) {
    assert.equal(after[field], before[field], `proof-buffer Close changed ${field}`);
  }
  assert.equal(after.treasuryLamports - before.treasuryLamports, before.proofBufferLamports, "proof-buffer Close treasury delta changed");
  let terminalEntry = journal.entries.findLast((entry) => (
    entry.event === "proof-buffer-close-finalized"
    && entry.stage === "former-authority-proof-buffer-close"
    && entry.signature === prepared.signature
  ));
  if (!terminalEntry) {
    terminalEntry = await journal.append("proof-buffer-close-finalized", {
      stage: "former-authority-proof-buffer-close",
      signature: prepared.signature,
      slot: landed.slot,
      messageSha256: prepared.messageSha256,
      wireSha256: prepared.wireSha256,
      wireBytes: prepared.wireBytes,
      feeLamports: landed.meta.fee,
      computeUnits: landed.meta.computeUnitsConsumed ?? null,
    });
  }
  const negativeProofFile = await requireSecureRegularFile(
    fileInRunDir(inputs.runDir, NEGATIVE_PROOF_FILE),
    "former-authority negative proof",
  );
  const receipt = {
    schema: PROOF_BUFFER_CLOSE_RECEIPT_SCHEMA,
    operationId: plan.operationId,
    planSha256: sha256Hex(Buffer.from(JSON.stringify(plan), "utf8")),
    mainnetAllowed: false,
    genesisHash: EXPECTED_GENESIS,
    stage: "former-authority-proof-buffer-close",
    proofBuffer: plan.identities.proofBuffer,
    proofBufferReceiptSha256: inputs.proofReceiptSha256,
    negativeProof: NEGATIVE_PROOF_FILE,
    negativeProofSha256: sha256Hex(await readFile(negativeProofFile)),
    negativeFailureSignature: negativeProof.signature,
    loader: BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58(),
    closeInstructionDataHex: LOADER_CLOSE_DATA.toString("hex"),
    formerAuthority: LEGACY_AUTHORITY.toBase58(),
    feePayer: PAYER.toBase58(),
    spillTreasury: TREASURY.toBase58(),
    messageSha256: prepared.messageSha256,
    wireSha256: prepared.wireSha256,
    wireBytes: prepared.wireBytes,
    signature: prepared.signature,
    finalizedSlot: landed.slot,
    proofBufferLamports: before.proofBufferLamports,
    treasuryLamportsBefore: before.treasuryLamports,
    treasuryLamportsAfter: after.treasuryLamports,
    treasuryLamportDelta: after.treasuryLamports - before.treasuryLamports,
    treasuryAccountSha256Before: before.treasuryAccountSha256,
    treasuryAccountSha256After: after.treasuryAccountSha256,
    proofBufferRawSha256Before: before.proofBufferRawSha256,
    proofBufferAccountSha256Before: before.proofBufferAccountSha256,
    proofBufferPoststate: null,
    targetProgram: TARGET.toBase58(),
    targetProgramdata: TARGET_PROGRAMDATA.toBase58(),
    controllerAuthority: plan.identities.controllerAuthority,
    programdataRawSha256Before: before.programdataRawSha256,
    programdataRawSha256After: after.programdataRawSha256,
    programdataDeployedSlotBefore: before.programdataDeployedSlot,
    programdataDeployedSlotAfter: after.programdataDeployedSlot,
    gateAccountSha256Before: before.gateAccountSha256,
    gateAccountSha256After: after.gateAccountSha256,
    handoffReceiptAccountSha256Before: before.handoffReceiptAccountSha256,
    handoffReceiptAccountSha256After: after.handoffReceiptAccountSha256,
    targetMutationObserved: false,
    journalEntrySha256: terminalEntry.entrySha256,
    receiptSha256: "",
  };
  receipt.receiptSha256 = proofBufferCloseReceiptSha256(receipt);
  const file = fileInRunDir(inputs.runDir, PROOF_BUFFER_CLOSE_RECEIPT_FILE);
  await writeJsonOnce(file, receipt);
  const bytes = await readFile(file);
  const result = { receipt, sha256: sha256Hex(bytes), file };
  await journal.append("proof-buffer-close-receipt-written", {
    receiptSha256: result.sha256,
    semanticReceiptSha256: receipt.receiptSha256,
    signature: receipt.signature,
    slot: receipt.finalizedSlot,
  });
  return result;
}

function assertProofBufferCloseJournal(journal, closeReceipt) {
  const prepared = journal.entries.find((entry) => (
    entry.event === "proof-buffer-close-prepared"
    && entry.stage === "former-authority-proof-buffer-close"
    && entry.signature === closeReceipt.receipt.signature
  ));
  assert(prepared, "proof-buffer Close receipt lacks its prepared transaction");
  const terminal = journal.entries.find((entry) => entry.entrySha256 === closeReceipt.receipt.journalEntrySha256);
  assert(terminal, "proof-buffer Close receipt is not anchored in the hash-chained journal");
  assert.equal(terminal.event, "proof-buffer-close-finalized");
  assert.equal(terminal.signature, closeReceipt.receipt.signature);
  assert.equal(terminal.slot, closeReceipt.receipt.finalizedSlot);
  return prepared;
}

async function verifyProofBufferCloseReceiptLive(connection, journal, inputs, plan, negativeProof, closeReceipt, validated) {
  const prepared = assertProofBufferCloseJournal(journal, closeReceipt);
  assertProofBufferClosePrepared(prepared, inputs, plan);
  const landed = await finalizedProofBufferCloseTransaction(connection, prepared, inputs, plan);
  assert(landed && landed.meta.err === null, "proof-buffer Close is not a finalized successful transaction");
  assert.equal(landed.slot, closeReceipt.receipt.finalizedSlot, "proof-buffer Close finalized slot changed");
  assert.equal(closeReceipt.receipt.proofBufferAccountSha256Before, prepared.stateSnapshot.proofBufferAccountSha256);
  assert.equal(closeReceipt.receipt.proofBufferRawSha256Before, prepared.stateSnapshot.proofBufferRawSha256);
  assert.equal(closeReceipt.receipt.proofBufferLamports, prepared.stateSnapshot.proofBufferLamports);
  assert.equal(closeReceipt.receipt.treasuryLamportsBefore, prepared.stateSnapshot.treasuryLamports);
  const current = proofBufferClosePoststate(validated);
  assert.equal(current.treasuryLamports, closeReceipt.receipt.treasuryLamportsAfter, "proof-buffer Close treasury balance changed");
  assert.equal(current.treasuryAccountSha256, closeReceipt.receipt.treasuryAccountSha256After, "proof-buffer Close treasury fingerprint changed");
  assert.equal(current.programdataRawSha256, closeReceipt.receipt.programdataRawSha256After);
  assert.equal(current.programdataDeployedSlot, closeReceipt.receipt.programdataDeployedSlotAfter);
  assert.equal(current.gateAccountSha256, closeReceipt.receipt.gateAccountSha256After);
  assert.equal(current.handoffReceiptAccountSha256, closeReceipt.receipt.handoffReceiptAccountSha256After);
  assert.equal(closeReceipt.receipt.negativeFailureSignature, negativeProof.signature);
}

async function executeProofBufferClose(connection, journal, inputs, plan, negativeProof, payer, initialValidated) {
  const existing = await loadProofBufferCloseReceipt(inputs, plan, negativeProof);
  if (existing) {
    await verifyProofBufferCloseReceiptLive(connection, journal, inputs, plan, negativeProof, existing, initialValidated);
    return existing;
  }
  const prior = proofBufferCloseAttempt(journal).prepared;
  if (prior) {
    const landed = await pollProofBufferCloseFinalized(connection, journal, prior, inputs, plan);
    assert(landed, "proof-buffer Close expired without landing; stop and create a new activation operation");
    const after = await readActivationLiveState(connection, inputs, plan, landed.slot, { recovered: true });
    return writeProofBufferCloseReceipt(inputs, plan, journal, negativeProof, prior, landed, after);
  }
  const validated = initialValidated;
  const action = nextActivationAction(validated, negativeProof, null, plan);
  assert.equal(action.stage, "former-authority-proof-buffer-close", "proof-buffer Close is no longer the next action");
  const blueprint = assertActivationStageBlueprint(plan, action);
  const latest = await connection.getLatestBlockhashAndContext({ commitment: "finalized", minContextSlot: validated.state.slot });
  assert(latest.context.slot >= validated.state.slot, "proof-buffer Close blockhash predates its finalized state");
  const message = new TransactionMessage({ payerKey: PAYER, recentBlockhash: latest.value.blockhash, instructions: action.instructions }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  const decodedEntry = await journal.append("decoded-action-displayed", {
    stage: action.stage,
    expectedSigners: action.signers.map((entry) => entry.toBase58()),
    instructions: action.instructions.map(instructionManifest),
    proofBuffer: plan.identities.proofBuffer,
    spillTreasury: TREASURY.toBase58(),
  });
  process.stdout.write(`${JSON.stringify({
    schema: "ameba-governance-devnet-decoded-action-v1",
    operationId: plan.operationId,
    stage: action.stage,
    expectedSigners: action.signers.map((entry) => entry.toBase58()),
    instructions: action.instructions.map(instructionManifest),
    proofBuffer: plan.identities.proofBuffer,
    spillTreasury: TREASURY.toBase58(),
  }, null, 2)}\n`);
  transaction.sign([payer]);
  const kmsEvidence = await signWithKms(transaction, inputs.runDir, action.stage, "legacy-target-authority");
  const wire = Buffer.from(transaction.serialize());
  assert.equal(wire.length, blueprint.packetBytes, "proof-buffer Close signed packet length changed");
  const simulation = await connection.simulateTransaction(transaction, {
    commitment: "processed",
    sigVerify: true,
    replaceRecentBlockhash: false,
    minContextSlot: latest.context.slot,
  });
  if (simulation.value.err !== null) {
    await journal.append("simulation-failed", {
      stage: action.stage,
      errorSha256: sha256Hex(Buffer.from(JSON.stringify(simulation.value.err), "utf8")),
      logsSha256: sha256Hex(Buffer.from(JSON.stringify(simulation.value.logs ?? []), "utf8")),
    });
    throw new Error("proof-buffer Close simulation failed; keep the gate frozen and stop");
  }
  await journal.append("simulation-passed", {
    stage: action.stage,
    unitsConsumed: simulation.value.unitsConsumed ?? null,
    logsSha256: sha256Hex(Buffer.from(JSON.stringify(simulation.value.logs ?? []), "utf8")),
    kmsEvidence,
  });
  const beforeValidated = await readActivationLiveState(connection, inputs, plan, latest.context.slot);
  await verifyNegativeProofLive(connection, journal, inputs, plan, negativeProof, beforeValidated);
  const before = proofBufferClosePrestate(beforeValidated, inputs);
  assert.equal(before.proofBufferRawSha256, plan.negative.proofBufferRawSha256);
  assert.equal(before.proofBufferLamports, plan.negative.proofBufferLamports);
  assert.equal(before.treasuryLamports, plan.negative.spillTreasuryLamportsBeforeClose);
  const blockhashValidity = await connection.isBlockhashValid(latest.value.blockhash, {
    commitment: "finalized",
    minContextSlot: beforeValidated.state.slot,
  });
  assert(blockhashValidity.context.slot >= beforeValidated.state.slot, "proof-buffer Close blockhash validation predates its pre-submit state");
  assert.equal(blockhashValidity.value, true, "proof-buffer Close blockhash expired before submission; create a fresh activation plan");
  const signature = bs58.encode(transaction.signatures[0]);
  const prepared = await journal.append("proof-buffer-close-prepared", {
    stage: action.stage,
    signature,
    blockhash: latest.value.blockhash,
    lastValidBlockHeight: latest.value.lastValidBlockHeight,
    minContextSlot: beforeValidated.state.slot,
    expectedSigners: action.signers.map((entry) => entry.toBase58()),
    messageSha256: sha256Hex(Buffer.from(message.serialize())),
    wireSha256: sha256Hex(wire),
    wireBytes: wire.length,
    wireBase64: wire.toString("base64"),
    simulation: {
      error: simulation.value.err,
      logs: simulation.value.logs ?? [],
      unitsConsumed: simulation.value.unitsConsumed ?? null,
    },
    decodedActionEntrySha256: decodedEntry.entrySha256,
    stateSnapshot: before,
  });
  let returnedSignature;
  try {
    returnedSignature = await connection.sendRawTransaction(wire, {
      skipPreflight: false,
      preflightCommitment: "processed",
      maxRetries: 0,
      minContextSlot: beforeValidated.state.slot,
    });
  } catch (error) {
    if (error instanceof RpcBackoffExit) throw error;
    await journal.append("proof-buffer-close-submission-unknown", {
      stage: action.stage,
      signature,
      errorSha256: sha256Hex(Buffer.from(String(error?.message ?? error), "utf8")),
    });
    throw new Error(`proof-buffer Close submission outcome is unknown; reconcile ${signature} without resubmission`);
  }
  assert.equal(returnedSignature, signature, "proof-buffer Close RPC returned a different signature");
  await journal.append("proof-buffer-close-submitted", { stage: action.stage, signature });
  const landed = await pollProofBufferCloseFinalized(connection, journal, prepared, inputs, plan);
  assert(landed, "proof-buffer Close expired without landing; stop and create a new activation operation");
  const after = await readActivationLiveState(connection, inputs, plan, landed.slot, { completed: true });
  return writeProofBufferCloseReceipt(inputs, plan, journal, negativeProof, prepared, landed, after);
}

function unresolvedPreparedStages(journal) {
  const attempts = new Map();
  for (const entry of journal.entries) {
    if (entry.event === "prepared") attempts.set(entry.stage, true);
    if (["finalized", "reconciled-finalized", "transaction-failed", "expired-not-landed"].includes(entry.event)) {
      attempts.delete(entry.stage);
    }
  }
  return [...attempts.keys()];
}

async function assertCurrentAction(connection, inputs, plan, expectedStage, minContextSlot = 0) {
  const validated = await validatedLiveState(connection, inputs, plan, minContextSlot);
  const action = nextAction(validated, inputs, plan);
  assert(!action.done && !action.pause, `${expectedStage} is no longer the next admissible action`);
  assert.equal(action.stage, expectedStage, `next handoff stage changed from ${expectedStage} to ${action.stage}`);
  assertStageBlueprint(plan, action);
  return { validated, action, slot: validated.state.slot };
}

function currentActionObservationSlot(current, stage) {
  assert(
    Number.isSafeInteger(current?.slot) && current.slot > 0,
    `${stage} finalized action observation slot is invalid`,
  );
  return current.slot;
}

async function reconcileJournal(connection, journal, inputs, plan) {
  const unresolved = unresolvedPreparedStages(journal);
  for (const stage of unresolved) {
    const blueprint = blueprintForStage(plan, stage);
    await reconcileOneFinalized({
      connection,
      journal,
      operationId: plan.operationId,
      stage,
      expectedSigners: blueprint.expectedSigners.map((entry) => publicKey(entry, `${stage} planned signer`)),
      expectedPacketBytes: blueprint.packetBytes,
      verifyImmediatelyBeforeResubmit: async () => {
        throw new Error(`${stage} automatic rebroadcast is forbidden`);
      },
      verifyExpiredPrestate: async (minContextSlot) => {
        const current = await assertCurrentAction(connection, inputs, plan, stage, minContextSlot);
        return current.slot;
      },
    });
  }
  assert.equal(unresolvedPreparedStages(journal).length, 0, "handoff reconciliation left an ambiguous prepared transaction");
}

async function submitAction(connection, journal, inputs, plan, payer, initialAction, minimumContextSlot) {
  const blueprint = assertStageBlueprint(plan, initialAction);
  const preSign = await assertCurrentAction(connection, inputs, plan, initialAction.stage, minimumContextSlot);
  const latest = await connection.getLatestBlockhashAndContext({
    commitment: "finalized",
    minContextSlot: preSign.validated.state.slot,
  });
  assert(latest.context.slot >= preSign.validated.state.slot, `${initialAction.stage} blockhash predates pre-sign state`);
  const action = preSign.action;
  const message = new TransactionMessage({
    payerKey: PAYER,
    recentBlockhash: latest.value.blockhash,
    instructions: action.instructions,
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  await journal.append("decoded-action-displayed", {
    stage: action.stage,
    expectedSigners: action.signers.map((entry) => entry.toBase58()),
    instructions: action.instructions.map(instructionManifest),
    gateEpoch: plan.gate.epoch,
    targetNonce: plan.governance.targetNonce,
    proposal: plan.handoff.proposal,
    observation: plan.observation.account,
  });
  process.stdout.write(`${JSON.stringify({
    schema: "ameba-governance-devnet-decoded-action-v1",
    operationId: plan.operationId,
    stage: action.stage,
    expectedSigners: action.signers.map((entry) => entry.toBase58()),
    instructions: action.instructions.map(instructionManifest),
    gateEpoch: plan.gate.epoch,
    targetNonce: plan.governance.targetNonce,
    proposal: plan.handoff.proposal,
    observation: plan.observation.account,
  }, null, 2)}\n`);
  transaction.sign([payer]);
  let kmsEvidence = null;
  if (action.kmsRole) kmsEvidence = await signWithKms(transaction, inputs.runDir, action.stage, action.kmsRole);
  assert.equal(Buffer.from(transaction.serialize()).length, blueprint.packetBytes, `${action.stage} signed packet length changed`);
  const simulation = await connection.simulateTransaction(transaction, {
    commitment: "processed",
    sigVerify: true,
    replaceRecentBlockhash: false,
    minContextSlot: latest.context.slot,
  });
  if (simulation.value.err !== null) {
    await journal.append("simulation-failed", {
      stage: action.stage,
      errorSha256: sha256Hex(Buffer.from(JSON.stringify(simulation.value.err), "utf8")),
      logsSha256: sha256Hex(Buffer.from(JSON.stringify(simulation.value.logs ?? []), "utf8")),
    });
    throw new Error(`${action.stage} simulation failed; see hash-only journal evidence`);
  }
  await journal.append("simulation-passed", {
    stage: action.stage,
    unitsConsumed: simulation.value.unitsConsumed ?? null,
    logsSha256: sha256Hex(Buffer.from(JSON.stringify(simulation.value.logs ?? []), "utf8")),
    kmsEvidence,
  });
  const landed = await submitOneFinalized({
    connection,
    transaction,
    latestBlockhash: latest.value,
    journal,
    operationId: plan.operationId,
    stage: action.stage,
    expectedSigners: action.signers,
    expectedPacketBytes: blueprint.packetBytes,
    minContextSlot: latest.context.slot,
    preparedContext: {
      simulationUnitsConsumed: simulation.value.unitsConsumed ?? null,
      kmsRole: action.kmsRole,
      decodedActionEntrySha256: journal.entries.at(-2)?.entrySha256 ?? null,
    },
    verifyImmediatelyBeforeSubmit: async (minContextSlot) => {
      const current = await assertCurrentAction(connection, inputs, plan, action.stage, minContextSlot);
      return currentActionObservationSlot(current, action.stage);
    },
  });
  return landed;
}

function assertActivationArm(plan) {
  const expected = `execute-activation:${plan.operationId}`;
  assert.equal(process.env.AMEBA_CEREMONY_ARM?.trim(), expected, `set AMEBA_CEREMONY_ARM=${expected} to execute this exact plan`);
}

async function assertCurrentActivationAction(
  connection,
  inputs,
  plan,
  negativeProof,
  proofBufferCloseReceipt,
  expectedStage,
  minContextSlot = 0,
) {
  const validated = await readActivationLiveState(
    connection,
    inputs,
    plan,
    minContextSlot,
    proofBufferCloseReceipt,
  );
  const action = nextActivationAction(validated, negativeProof, proofBufferCloseReceipt, plan);
  assert(!action.done && !action.pause, `${expectedStage} is no longer the next admissible activation action`);
  assert.equal(action.stage, expectedStage, `next activation stage changed from ${expectedStage} to ${action.stage}`);
  assertActivationStageBlueprint(plan, action);
  return { validated, action, slot: validated.state.slot };
}

async function reconcileActivationJournal(connection, journal, inputs, plan, negativeProof, proofBufferCloseReceipt) {
  assert(negativeProof, "ordinary activation reconciliation requires the finalized former-authority negative proof");
  assert(proofBufferCloseReceipt, "ordinary activation reconciliation requires the finalized proof-buffer close receipt");
  const unresolved = unresolvedPreparedStages(journal);
  for (const stage of unresolved) {
    const blueprint = activationBlueprintForStage(plan, stage);
    await reconcileOneFinalized({
      connection,
      journal,
      operationId: plan.operationId,
      stage,
      expectedSigners: blueprint.expectedSigners.map((entry) => publicKey(entry, `${stage} planned signer`)),
      expectedPacketBytes: blueprint.packetBytes,
      verifyImmediatelyBeforeResubmit: async () => {
        throw new Error(`${stage} automatic rebroadcast is forbidden`);
      },
      verifyExpiredPrestate: async (minContextSlot) => {
        const current = await assertCurrentActivationAction(
          connection,
          inputs,
          plan,
          negativeProof,
          proofBufferCloseReceipt,
          stage,
          minContextSlot,
        );
        return current.slot;
      },
    });
  }
  assert.equal(unresolvedPreparedStages(journal).length, 0, "activation reconciliation left an ambiguous prepared transaction");
}

async function submitActivationAction(
  connection,
  journal,
  inputs,
  plan,
  negativeProof,
  proofBufferCloseReceipt,
  payer,
  initialAction,
  minimumContextSlot,
) {
  const blueprint = assertActivationStageBlueprint(plan, initialAction);
  const preSign = await assertCurrentActivationAction(
    connection,
    inputs,
    plan,
    negativeProof,
    proofBufferCloseReceipt,
    initialAction.stage,
    minimumContextSlot,
  );
  const latest = await connection.getLatestBlockhashAndContext({
    commitment: "finalized",
    minContextSlot: preSign.validated.state.slot,
  });
  assert(latest.context.slot >= preSign.validated.state.slot, `${initialAction.stage} blockhash predates its finalized pre-sign state`);
  const action = preSign.action;
  const message = new TransactionMessage({
    payerKey: PAYER,
    recentBlockhash: latest.value.blockhash,
    instructions: action.instructions,
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  const decoded = {
    schema: "ameba-governance-devnet-decoded-action-v1",
    operationId: plan.operationId,
    stage: action.stage,
    expectedSigners: action.signers.map((entry) => entry.toBase58()),
    instructions: action.instructions.map(instructionManifest),
    gateEpoch: plan.gate.epoch,
    targetNonce: plan.governance.targetNonce,
    proposal: plan.activation.proposal,
    observation: plan.observation.account,
  };
  const decodedEntry = await journal.append("decoded-action-displayed", {
    stage: action.stage,
    expectedSigners: decoded.expectedSigners,
    instructions: decoded.instructions,
    gateEpoch: decoded.gateEpoch,
    targetNonce: decoded.targetNonce,
    proposal: decoded.proposal,
    observation: decoded.observation,
  });
  process.stdout.write(`${JSON.stringify(decoded, null, 2)}\n`);
  transaction.sign([payer]);
  let kmsEvidence = null;
  if (action.kmsRole) kmsEvidence = await signWithKms(transaction, inputs.runDir, action.stage, action.kmsRole);
  assert.equal(Buffer.from(transaction.serialize()).length, blueprint.packetBytes, `${action.stage} signed packet length changed`);
  const simulation = await connection.simulateTransaction(transaction, {
    commitment: "processed",
    sigVerify: true,
    replaceRecentBlockhash: false,
    minContextSlot: latest.context.slot,
  });
  if (simulation.value.err !== null) {
    await journal.append("simulation-failed", {
      stage: action.stage,
      errorSha256: sha256Hex(Buffer.from(JSON.stringify(simulation.value.err), "utf8")),
      logsSha256: sha256Hex(Buffer.from(JSON.stringify(simulation.value.logs ?? []), "utf8")),
    });
    throw new Error(`${action.stage} simulation failed; see hash-only journal evidence`);
  }
  await journal.append("simulation-passed", {
    stage: action.stage,
    unitsConsumed: simulation.value.unitsConsumed ?? null,
    logsSha256: sha256Hex(Buffer.from(JSON.stringify(simulation.value.logs ?? []), "utf8")),
    kmsEvidence,
  });
  const landed = await submitOneFinalized({
    connection,
    transaction,
    latestBlockhash: latest.value,
    journal,
    operationId: plan.operationId,
    stage: action.stage,
    expectedSigners: action.signers,
    expectedPacketBytes: blueprint.packetBytes,
    minContextSlot: latest.context.slot,
    preparedContext: {
      simulationUnitsConsumed: simulation.value.unitsConsumed ?? null,
      kmsRole: action.kmsRole,
      decodedActionEntrySha256: decodedEntry.entrySha256,
    },
    verifyImmediatelyBeforeSubmit: async (minContextSlot) => {
      const current = await assertCurrentActivationAction(
        connection,
        inputs,
        plan,
        negativeProof,
        proofBufferCloseReceipt,
        action.stage,
        minContextSlot,
      );
      return currentActionObservationSlot(current, action.stage);
    },
  });
  return landed;
}

function activationProtectedSnapshot(validated) {
  assert(validated.progress.observation && validated.progress.proposal && validated.progress.receipt && validated.progress.deployment, "activation protected snapshot requires complete final accounts");
  return {
    controllerProgramdataRawSha256: sha256Hex(validated.state.controllerProgramdata.raw),
    targetProgramdataRawSha256: sha256Hex(validated.state.targetProgramdata.raw),
    targetProgramdataDeployedSlot: validated.state.targetProgramdata.deployedSlot.toString(),
    protocolGateAccountSha256: validated.state.baseFingerprints.protocolGate.dataSha256,
    handoffReceiptAccountSha256: sha256Hex(validated.handoffReceiptAccount.data),
    activationObservationAccountSha256: sha256Hex(validated.progress.accounts[0].data),
    activationProposalAccountSha256: sha256Hex(validated.progress.accounts[1].data),
    activationReceiptAccountSha256: sha256Hex(validated.progress.accounts[2].data),
    currentDeploymentAccountSha256: sha256Hex(validated.progress.accounts[3].data),
  };
}

function assertEpochProbeResult(result, stage, expectedCode) {
  assertExactKeys(result, [
    "stage", "epoch", "expectedCustomError", "messageSha256", "wireSha256",
    "wireBytes", "simulationError", "simulationLogs", "unitsConsumed",
  ], `${stage} probe result`);
  assert.equal(result.stage, stage);
  assert.equal(result.expectedCustomError, expectedCode);
  assertLowerHash(result.messageSha256, `${stage} message SHA-256`);
  assertLowerHash(result.wireSha256, `${stage} wire SHA-256`);
  assertCustomInstructionError(result.simulationError, expectedCode, stage);
  assert(Array.isArray(result.simulationLogs), `${stage} logs are malformed`);
}

async function loadEpochProbeReceipt(inputs, plan) {
  const file = fileInRunDir(inputs.runDir, EPOCH_PROBE_RECEIPT_FILE);
  let bytes;
  try {
    bytes = await readFile(file);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  await requireSecureRegularFile(file, "Spread epoch-probe receipt");
  const receipt = JSON.parse(bytes.toString("utf8"));
  assertExactKeys(receipt, EPOCH_PROBE_RECEIPT_KEYS, "Spread epoch-probe receipt");
  assert.equal(receipt.schema, EPOCH_PROBE_RECEIPT_SCHEMA);
  assert.equal(receipt.operationId, plan.operationId);
  assert.equal(receipt.planSha256, sha256Hex(Buffer.from(JSON.stringify(plan), "utf8")));
  assert.equal(receipt.mainnetAllowed, false);
  assert.equal(receipt.genesisHash, EXPECTED_GENESIS);
  assert.equal(receipt.targetProgram, TARGET.toBase58());
  assert.equal(receipt.protocolGate, plan.identities.protocolGate);
  assert.equal(receipt.oldEpoch, plan.gate.epoch);
  assert.equal(receipt.currentEpoch, plan.gate.nextEpoch);
  assert.equal(receipt.stateSha256Before, receipt.stateSha256After, "epoch-probe simulations changed protected state");
  assert.equal(receipt.stateMutationObserved, false);
  assertEpochProbeResult(receipt.oldEpochResult, "simulate-old-epoch", plan.activation.simulationProbe.staleEpochExpectedCustomError);
  assertEpochProbeResult(receipt.currentEpochResult, "simulate-current-epoch", plan.activation.simulationProbe.currentEpochExpectedCustomError);
  return { receipt, sha256: sha256Hex(bytes) };
}

function assertEpochProbeJournal(journal, epochProof) {
  const entry = journal.entries.findLast((candidate) => (
    ["epoch-probe-receipt-written", "epoch-probe-receipt-reconciled"].includes(candidate.event)
    && candidate.receiptSha256 === epochProof.sha256
  ));
  assert(entry, "epoch-probe receipt is not anchored in the hash-chained journal");
  assert.equal(entry.oldEpoch, epochProof.receipt.oldEpoch, "journaled old probe epoch changed");
  assert.equal(entry.currentEpoch, epochProof.receipt.currentEpoch, "journaled current probe epoch changed");
}

async function ensureEpochProbeJournalAnchor(journal, epochProof) {
  const anchored = journal.entries.some((candidate) => (
    ["epoch-probe-receipt-written", "epoch-probe-receipt-reconciled"].includes(candidate.event)
    && candidate.receiptSha256 === epochProof.sha256
  ));
  if (!anchored) {
    await journal.append("epoch-probe-receipt-reconciled", {
      receiptSha256: epochProof.sha256,
      oldEpoch: epochProof.receipt.oldEpoch,
      currentEpoch: epochProof.receipt.currentEpoch,
    });
  }
  assertEpochProbeJournal(journal, epochProof);
}

async function simulateEpochProbe(
  connection,
  journal,
  inputs,
  plan,
  proofBufferCloseReceipt,
  payer,
  validated,
  stage,
  epoch,
  expectedCode,
) {
  const before = activationProtectedSnapshot(validated);
  const action = {
    stage,
    instructions: [harmlessGovernedSpreadProbe(epoch, validated.state.ids.gate)],
    signers: [PAYER],
    kmsRole: null,
  };
  const blueprint = assertActivationStageBlueprint(plan, action);
  const latest = await connection.getLatestBlockhashAndContext({
    commitment: "finalized",
    minContextSlot: validated.state.slot,
  });
  assert(latest.context.slot >= validated.state.slot, `${stage} blockhash predates finalized activation state`);
  const immediate = await readActivationLiveState(
    connection,
    inputs,
    plan,
    latest.context.slot,
    proofBufferCloseReceipt,
  );
  assert.deepEqual(activationProtectedSnapshot(immediate), before, `${stage} pre-simulation state changed`);
  const message = new TransactionMessage({
    payerKey: PAYER,
    recentBlockhash: latest.value.blockhash,
    instructions: action.instructions,
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  const decoded = {
    schema: "ameba-governance-devnet-decoded-simulation-v1",
    operationId: plan.operationId,
    stage,
    epoch: epoch.toString(),
    submissionAllowed: false,
    expectedCustomError: expectedCode,
    instructions: action.instructions.map(instructionManifest),
  };
  process.stdout.write(`${JSON.stringify(decoded, null, 2)}\n`);
  await journal.append("decoded-simulation-displayed", {
    stage,
    epoch: epoch.toString(),
    submissionAllowed: false,
    expectedCustomError: expectedCode,
    instructions: decoded.instructions,
  });
  transaction.sign([payer]);
  const wire = Buffer.from(transaction.serialize());
  assert.equal(wire.length, blueprint.packetBytes, `${stage} packet length changed`);
  const simulation = await connection.simulateTransaction(transaction, {
    commitment: "processed",
    sigVerify: true,
    replaceRecentBlockhash: false,
    minContextSlot: latest.context.slot,
  });
  assertCustomInstructionError(simulation.value.err, expectedCode, stage);
  const afterValidated = await readActivationLiveState(
    connection,
    inputs,
    plan,
    latest.context.slot,
    proofBufferCloseReceipt,
  );
  const after = activationProtectedSnapshot(afterValidated);
  assert.deepEqual(after, before, `${stage} simulation changed protected state`);
  const result = {
    stage,
    epoch: epoch.toString(),
    expectedCustomError: expectedCode,
    messageSha256: sha256Hex(Buffer.from(message.serialize())),
    wireSha256: sha256Hex(wire),
    wireBytes: wire.length,
    simulationError: simulation.value.err,
    simulationLogs: simulation.value.logs ?? [],
    unitsConsumed: simulation.value.unitsConsumed ?? null,
  };
  await journal.append("epoch-probe-simulated", {
    stage,
    epoch: epoch.toString(),
    expectedCustomError: expectedCode,
    messageSha256: result.messageSha256,
    wireSha256: result.wireSha256,
    logsSha256: sha256Hex(Buffer.from(JSON.stringify(result.simulationLogs), "utf8")),
    stateSha256: sha256Hex(Buffer.from(JSON.stringify(after), "utf8")),
  });
  return { result, validated: afterValidated, snapshot: after };
}

async function ensureEpochProbeReceipt(
  connection,
  journal,
  inputs,
  plan,
  proofBufferCloseReceipt,
  payer,
  initialValidated,
) {
  const existing = await loadEpochProbeReceipt(inputs, plan);
  if (existing) {
    const currentSnapshot = activationProtectedSnapshot(initialValidated);
    assert.equal(
      existing.receipt.stateSha256After,
      sha256Hex(Buffer.from(JSON.stringify(currentSnapshot), "utf8")),
      "existing epoch-probe receipt does not bind the current finalized activation state",
    );
    assert(initialValidated.state.slot >= existing.receipt.observedSlotAfter, "current finalized state predates the epoch-probe receipt");
    await ensureEpochProbeJournalAnchor(journal, existing);
    return existing;
  }
  assert.equal(initialValidated.state.gate.status, GateStatusV1.Active, "epoch probes require the finalized Active gate");
  assert(initialValidated.progress.receipt && initialValidated.progress.deployment, "epoch probes require finalized activation evidence");
  const before = activationProtectedSnapshot(initialValidated);
  const oldResult = await simulateEpochProbe(
    connection,
    journal,
    inputs,
    plan,
    proofBufferCloseReceipt,
    payer,
    initialValidated,
    "simulate-old-epoch",
    BigInt(plan.gate.epoch),
    plan.activation.simulationProbe.staleEpochExpectedCustomError,
  );
  const currentResult = await simulateEpochProbe(
    connection,
    journal,
    inputs,
    plan,
    proofBufferCloseReceipt,
    payer,
    oldResult.validated,
    "simulate-current-epoch",
    BigInt(plan.gate.nextEpoch),
    plan.activation.simulationProbe.currentEpochExpectedCustomError,
  );
  const after = currentResult.snapshot;
  assert.deepEqual(after, before, "epoch-probe pair changed protected state");
  const receipt = {
    schema: EPOCH_PROBE_RECEIPT_SCHEMA,
    operationId: plan.operationId,
    planSha256: sha256Hex(Buffer.from(JSON.stringify(plan), "utf8")),
    mainnetAllowed: false,
    genesisHash: EXPECTED_GENESIS,
    targetProgram: TARGET.toBase58(),
    protocolGate: plan.identities.protocolGate,
    oldEpoch: plan.gate.epoch,
    currentEpoch: plan.gate.nextEpoch,
    observedSlotBefore: initialValidated.state.slot,
    observedSlotAfter: currentResult.validated.state.slot,
    stateSha256Before: sha256Hex(Buffer.from(JSON.stringify(before), "utf8")),
    stateSha256After: sha256Hex(Buffer.from(JSON.stringify(after), "utf8")),
    stateMutationObserved: false,
    oldEpochResult: oldResult.result,
    currentEpochResult: currentResult.result,
  };
  const file = fileInRunDir(inputs.runDir, EPOCH_PROBE_RECEIPT_FILE);
  await writeJsonOnce(file, receipt);
  const bytes = await readFile(file);
  await journal.append("epoch-probe-receipt-written", {
    receiptSha256: sha256Hex(bytes),
    oldEpoch: receipt.oldEpoch,
    currentEpoch: receipt.currentEpoch,
  });
  const result = { receipt, sha256: sha256Hex(bytes) };
  assertEpochProbeJournal(journal, result);
  return result;
}

async function loadActivationReceipt(
  inputs,
  plan,
  negativeProof,
  proofBufferCloseReceipt,
  epochProof,
  validated,
) {
  const file = fileInRunDir(inputs.runDir, ACTIVATION_RECEIPT_FILE);
  let bytes;
  try {
    bytes = await readFile(file);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  await requireSecureRegularFile(file, "bootstrap activation receipt");
  const receipt = JSON.parse(bytes.toString("utf8"));
  assertExactKeys(receipt, ACTIVATION_RECEIPT_KEYS, "bootstrap activation receipt");
  assert.equal(receipt.schema, ACTIVATION_RECEIPT_SCHEMA);
  assert.equal(receipt.operationId, plan.operationId);
  assert.equal(receipt.planSha256, sha256Hex(Buffer.from(JSON.stringify(plan), "utf8")));
  assert.equal(receipt.mainnetAllowed, false);
  assert.equal(receipt.genesisHash, EXPECTED_GENESIS);
  assert.equal(receipt.controllerProgram, CONTROLLER.toBase58());
  assert.equal(receipt.controllerProgramdata, CONTROLLER_PROGRAMDATA.toBase58());
  assert.equal(receipt.controllerConfig, plan.identities.controllerConfig);
  assert.equal(receipt.controllerAuthority, plan.identities.controllerAuthority);
  assert.equal(receipt.targetProgram, TARGET.toBase58());
  assert.equal(receipt.targetProgramdata, TARGET_PROGRAMDATA.toBase58());
  const negativeProofFile = await requireSecureRegularFile(fileInRunDir(inputs.runDir, NEGATIVE_PROOF_FILE), "former-authority negative proof");
  assert.equal(receipt.negativeProofSha256, sha256Hex(await readFile(negativeProofFile)));
  assert.equal(receipt.negativeProof, NEGATIVE_PROOF_FILE);
  assert.equal(receipt.negativeFailureSignature, negativeProof.signature);
  assert.equal(receipt.negativeFailureFinalizedSlot, negativeProof.finalizedSlot);
  assert.equal(receipt.proofBufferCloseReceipt, PROOF_BUFFER_CLOSE_RECEIPT_FILE);
  assert.equal(receipt.proofBufferCloseReceiptSha256, proofBufferCloseReceipt.sha256);
  assert.equal(receipt.proofBufferCloseSignature, proofBufferCloseReceipt.receipt.signature);
  assert.equal(receipt.proofBufferCloseFinalizedSlot, proofBufferCloseReceipt.receipt.finalizedSlot);
  assert.equal(receipt.epochProbeReceipt, EPOCH_PROBE_RECEIPT_FILE);
  assert.equal(receipt.epochProbeReceiptSha256, epochProof.sha256);
  assert.equal(receipt.targetNonceBefore, plan.governance.targetNonce);
  assert.equal(receipt.targetNonceAfter, plan.governance.targetNonce);
  assert.equal(receipt.targetNonceConsumed, false);
  assert.equal(receipt.authorityBefore, plan.identities.controllerAuthority);
  assert.equal(receipt.authorityAfter, plan.identities.controllerAuthority);
  assert.equal(receipt.artifactBytes, plan.artifact.bytes);
  assert.equal(receipt.artifactSha256, plan.artifact.sha256);
  assert.equal(receipt.artifactMerkleRoot, plan.artifact.merkleRoot);
  assert.equal(receipt.programdataDeployedSlot, plan.programdata.deployedSlot);
  assert.equal(receipt.programdataCapacity, plan.programdata.capacity);
  assert.equal(receipt.programdataRawSha256, plan.programdata.rawSha256);
  assert.equal(receipt.programdataPayloadSha256, plan.programdata.payloadSha256);
  assert.equal(receipt.controllerRemainedImmutable, true);
  assert.equal(receipt.loaderCpiExecuted, false);
  assert.equal(receipt.bootstrapActivationCompleted, true);
  const postActivation = assertPostActivationAuthorityDelta(inputs, validated);
  assert.equal(receipt.postHandoffAuthorityDeltaReceipt, path.basename(inputs.postHandoffAuthorityDelta.file));
  assert.equal(receipt.postHandoffAuthorityDeltaReceiptRawSha256, inputs.postHandoffAuthorityDelta.sha256);
  assert.equal(receipt.postHandoffAuthorityDeltaReceiptSha256, inputs.postHandoffAuthorityDelta.value.receiptSha256);
  assert.equal(receipt.postActivationAuthorityDeltaReceipt, path.basename(postActivation.file));
  assert.equal(receipt.postActivationAuthorityDeltaReceiptRawSha256, postActivation.sha256);
  assert.equal(receipt.postActivationAuthorityDeltaReceiptSha256, postActivation.value.receiptSha256);
  assert.equal(receipt.postActivationCensusRawSha256, postActivation.census.sha256);
  assert.equal(receipt.postActivationProgramDataRawSha256, postActivation.currentRaw.sha256);
  assert(validated.progress.observation && validated.progress.proposal && validated.progress.receipt && validated.progress.deployment, "local activation receipt lacks finalized on-chain evidence");
  assert.equal(
    epochProof.receipt.stateSha256After,
    sha256Hex(Buffer.from(JSON.stringify(activationProtectedSnapshot(validated)), "utf8")),
    "epoch-probe receipt does not bind the current finalized activation state",
  );
  assert.equal(receipt.observation, plan.observation.account);
  assert.equal(receipt.observationDigest, validated.progress.observation.observationDigest.toString("hex"));
  assert.equal(receipt.observationRoot, validated.progress.observation.finalRawMerkleRoot.toString("hex"));
  assert.equal(receipt.activationProposal, plan.activation.proposal);
  assert.equal(receipt.activationProposalDigest, validated.progress.proposal.proposalDigest.toString("hex"));
  assert.equal(receipt.activationReceipt, plan.activation.receipt);
  assert.equal(receipt.activationReceiptDigest, validated.progress.receipt.receiptDigest.toString("hex"));
  assert.equal(receipt.currentDeployment, plan.activation.currentDeployment);
  assert.equal(receipt.currentDeploymentDigest, validated.progress.deployment.deploymentDigest.toString("hex"));
  assert.equal(receipt.gateBefore.status, plan.gate.status);
  assert.equal(receipt.gateBefore.epoch, plan.gate.epoch);
  assert.equal(receipt.gateAfter.status, GateStatusV1.Active);
  assert.equal(receipt.gateAfter.epoch, plan.gate.nextEpoch);
  assert.equal(receipt.gateAfter.lastCompletedProposal, plan.activation.proposal);
  assert.equal(receipt.accountRawSha256.observation, sha256Hex(validated.progress.accounts[0].data));
  assert.equal(receipt.accountRawSha256.proposal, sha256Hex(validated.progress.accounts[1].data));
  assert.equal(receipt.accountRawSha256.receipt, sha256Hex(validated.progress.accounts[2].data));
  assert.equal(receipt.accountRawSha256.currentDeployment, sha256Hex(validated.progress.accounts[3].data));
  assert.equal(receipt.accountRawSha256.protocolGate, validated.state.baseFingerprints.protocolGate.dataSha256);
  assert.equal(receipt.accountRawSha256.targetProgramdata, sha256Hex(validated.state.targetProgramdata.raw));
  assert.equal(receipt.accountRawSha256.handoffReceipt, sha256Hex(validated.handoffReceiptAccount.data));
  assert.equal(receipt.accountRawSha256.proofBufferFingerprint, structuralFingerprintSha256(validated.proofBufferAccount));
  assert.equal(receipt.accountRawSha256.spillTreasuryFingerprint, structuralFingerprintSha256(validated.treasuryAccount));
  const expectedStages = [
    ...plan.transactionBlueprints.observation.map((entry) => entry.stage),
    plan.transactionBlueprints.create.stage,
    ...plan.transactionBlueprints.approvals.map((entry) => entry.stage),
    plan.transactionBlueprints.queue.stage,
    plan.transactionBlueprints.execute.stage,
  ];
  assert.deepEqual(receipt.finalizedTransactions.map((entry) => entry.stage), expectedStages, "local activation receipt transaction sequence changed");
  return { receipt, sha256: sha256Hex(bytes) };
}

function assertActivationReceiptJournal(journal, activationReceipt) {
  const entry = journal.entries.findLast((candidate) => (
    ["activation-receipt-written", "activation-receipt-reconciled"].includes(candidate.event)
    && candidate.receiptSha256 === activationReceipt.sha256
  ));
  assert(entry, "bootstrap activation receipt is not anchored in the hash-chained journal");
  assert.equal(entry.activationReceiptDigest, activationReceipt.receipt.activationReceiptDigest, "journaled activation receipt digest changed");
  assert.equal(entry.currentDeploymentDigest, activationReceipt.receipt.currentDeploymentDigest, "journaled current deployment digest changed");
  assert.equal(entry.gateEpoch, activationReceipt.receipt.gateAfter.epoch, "journaled activation gate epoch changed");
}

function assertActivationTransactionJournal(journal, activationReceipt) {
  for (const transaction of activationReceipt.receipt.finalizedTransactions) {
    const entry = journal.entries.find((candidate) => candidate.entrySha256 === transaction.entrySha256);
    assert(entry, `activation receipt stage ${transaction.stage} is not anchored in the hash-chained journal`);
    assert(["finalized", "reconciled-finalized"].includes(entry.event), `activation receipt stage ${transaction.stage} has the wrong journal event`);
    assert.equal(entry.stage, transaction.stage, `activation receipt stage ${transaction.stage} journal stage changed`);
    assert.equal(entry.signature, transaction.signature, `activation receipt stage ${transaction.stage} journal signature changed`);
    assert.equal(entry.slot, transaction.slot, `activation receipt stage ${transaction.stage} journal slot changed`);
    assert.equal(entry.messageSha256, transaction.messageSha256, `activation receipt stage ${transaction.stage} journal message changed`);
    assert.equal(entry.wireBytes, transaction.wireBytes, `activation receipt stage ${transaction.stage} journal packet length changed`);
  }
}

async function ensureActivationReceiptJournalAnchor(journal, activationReceipt) {
  assertActivationTransactionJournal(journal, activationReceipt);
  const anchored = journal.entries.some((candidate) => (
    ["activation-receipt-written", "activation-receipt-reconciled"].includes(candidate.event)
    && candidate.receiptSha256 === activationReceipt.sha256
  ));
  if (!anchored) {
    await journal.append("activation-receipt-reconciled", {
      receiptSha256: activationReceipt.sha256,
      activationReceiptDigest: activationReceipt.receipt.activationReceiptDigest,
      currentDeploymentDigest: activationReceipt.receipt.currentDeploymentDigest,
      gateEpoch: activationReceipt.receipt.gateAfter.epoch,
    });
  }
  assertActivationReceiptJournal(journal, activationReceipt);
}

async function finalizeActivationReceipt(
  inputs,
  plan,
  journal,
  negativeProof,
  proofBufferCloseReceipt,
  epochProof,
  validated,
) {
  const { state, progress } = validated;
  const postActivation = assertPostActivationAuthorityDelta(inputs, validated);
  assert.equal(state.gate.status, GateStatusV1.Active, "bootstrap activation receipt requires Active gate");
  assert(progress.observation && progress.proposal && progress.receipt && progress.deployment, "bootstrap activation final evidence is incomplete");
  assert.equal(progress.proposal.state, CeremonyProposalStateV1.Completed, "bootstrap activation proposal is not complete");
  const expectedStages = [
    ...plan.transactionBlueprints.observation.map((entry) => entry.stage),
    plan.transactionBlueprints.create.stage,
    ...plan.transactionBlueprints.approvals.map((entry) => entry.stage),
    plan.transactionBlueprints.queue.stage,
    plan.transactionBlueprints.execute.stage,
  ];
  const finalizedTransactions = safeFinalizedTransactions(journal);
  assert.deepEqual(finalizedTransactions.map((entry) => entry.stage), expectedStages, "activation finalized transaction history is incomplete or reordered");
  const negativeProofFile = await requireSecureRegularFile(fileInRunDir(inputs.runDir, NEGATIVE_PROOF_FILE), "former-authority negative proof");
  const negativeProofSha256 = sha256Hex(await readFile(negativeProofFile));
  const receipt = {
    schema: ACTIVATION_RECEIPT_SCHEMA,
    operationId: plan.operationId,
    planSha256: sha256Hex(Buffer.from(JSON.stringify(plan), "utf8")),
    mainnetAllowed: false,
    genesisHash: EXPECTED_GENESIS,
    controllerProgram: CONTROLLER.toBase58(),
    controllerProgramdata: CONTROLLER_PROGRAMDATA.toBase58(),
    controllerConfig: state.ids.config.toBase58(),
    controllerAuthority: state.ids.authority.toBase58(),
    targetProgram: TARGET.toBase58(),
    targetProgramdata: TARGET_PROGRAMDATA.toBase58(),
    handoffProposal: state.ids.handoffProposal.toBase58(),
    handoffProposalDigest: validated.handoffProposal.proposalDigest.toString("hex"),
    handoffReceipt: state.ids.handoffReceipt.toBase58(),
    handoffReceiptDigest: validated.handoffReceipt.receiptDigest.toString("hex"),
    handoffAcceptedSlot: validated.handoffReceipt.acceptedSlot.toString(),
    negativeProof: NEGATIVE_PROOF_FILE,
    negativeProofSha256,
    negativeFailureSignature: negativeProof.signature,
    negativeFailureFinalizedSlot: negativeProof.finalizedSlot,
    proofBufferCloseReceipt: PROOF_BUFFER_CLOSE_RECEIPT_FILE,
    proofBufferCloseReceiptSha256: proofBufferCloseReceipt.sha256,
    proofBufferCloseSignature: proofBufferCloseReceipt.receipt.signature,
    proofBufferCloseFinalizedSlot: proofBufferCloseReceipt.receipt.finalizedSlot,
    observation: plan.observation.account,
    observationDigest: progress.observation.observationDigest.toString("hex"),
    observationRoot: progress.observation.finalRawMerkleRoot.toString("hex"),
    activationProposal: state.ids.activationProposal.toBase58(),
    activationProposalDigest: progress.proposal.proposalDigest.toString("hex"),
    activationReceipt: state.ids.activationReceipt.toBase58(),
    activationReceiptDigest: progress.receipt.receiptDigest.toString("hex"),
    currentDeployment: state.ids.currentDeployment.toBase58(),
    currentDeploymentDigest: progress.deployment.deploymentDigest.toString("hex"),
    creationSlot: progress.proposal.creationSlot.toString(),
    reviewStartSlot: progress.proposal.reviewStartSlot.toString(),
    reviewEndSlot: progress.proposal.reviewEndSlot.toString(),
    notBeforeSlot: progress.proposal.notBeforeSlot.toString(),
    expirySlot: progress.proposal.expirySlot.toString(),
    executedSlot: progress.proposal.executedSlot.toString(),
    approvalBitset: progress.proposal.approvalBitset,
    approvalCount: progress.proposal.approvalCount,
    gateBefore: {
      status: plan.gate.status,
      epoch: plan.gate.epoch,
      freezeSlot: plan.gate.freezeSlot,
      freezeReasonCode: plan.gate.freezeReasonCode,
      activeProposal: plan.gate.activeProposal,
    },
    gateAfter: {
      status: state.gate.status,
      epoch: state.gate.epoch.toString(),
      freezeSlot: state.gate.freezeSlot.toString(),
      freezeReasonCode: state.gate.freezeReasonCode,
      activeProposal: state.gate.activeProposal.toBase58(),
      lastCompletedProposal: state.gate.lastCompletedProposal.toBase58(),
    },
    targetNonceBefore: plan.governance.targetNonce,
    targetNonceAfter: state.config.targetNonce.toString(),
    targetNonceConsumed: false,
    authorityBefore: state.ids.authority.toBase58(),
    authorityAfter: state.targetProgramdata.authority?.toBase58() ?? null,
    artifactBytes: plan.artifact.bytes,
    artifactSha256: plan.artifact.sha256,
    artifactMerkleRoot: plan.artifact.merkleRoot,
    programdataDeployedSlot: state.targetProgramdata.deployedSlot.toString(),
    programdataCapacity: state.targetProgramdata.payload.length,
    programdataRawSha256: sha256Hex(state.targetProgramdata.raw),
    programdataPayloadSha256: sha256Hex(state.targetProgramdata.payload),
    controllerRemainedImmutable: state.controllerProgramdata.authority === null,
    loaderCpiExecuted: false,
    epochProbeReceipt: EPOCH_PROBE_RECEIPT_FILE,
    epochProbeReceiptSha256: epochProof.sha256,
    postHandoffAuthorityDeltaReceipt: path.basename(inputs.postHandoffAuthorityDelta.file),
    postHandoffAuthorityDeltaReceiptRawSha256: inputs.postHandoffAuthorityDelta.sha256,
    postHandoffAuthorityDeltaReceiptSha256: inputs.postHandoffAuthorityDelta.value.receiptSha256,
    postActivationAuthorityDeltaReceipt: path.basename(postActivation.file),
    postActivationAuthorityDeltaReceiptRawSha256: postActivation.sha256,
    postActivationAuthorityDeltaReceiptSha256: postActivation.value.receiptSha256,
    postActivationCensusRawSha256: postActivation.census.sha256,
    postActivationProgramDataRawSha256: postActivation.currentRaw.sha256,
    finalizedTransactions,
    accountRawSha256: {
      observation: sha256Hex(progress.accounts[0].data),
      proposal: sha256Hex(progress.accounts[1].data),
      receipt: sha256Hex(progress.accounts[2].data),
      currentDeployment: sha256Hex(progress.accounts[3].data),
      protocolGate: state.baseFingerprints.protocolGate.dataSha256,
      targetProgramdata: sha256Hex(state.targetProgramdata.raw),
      handoffReceipt: sha256Hex(validated.handoffReceiptAccount.data),
      proofBufferFingerprint: structuralFingerprintSha256(validated.proofBufferAccount),
      spillTreasuryFingerprint: structuralFingerprintSha256(validated.treasuryAccount),
    },
    bootstrapActivationCompleted: true,
  };
  assert.equal(receipt.targetNonceBefore, receipt.targetNonceAfter, "bootstrap activation consumed target nonce");
  assert.equal(receipt.authorityAfter, state.ids.authority.toBase58(), "bootstrap activation changed target authority");
  assert.equal(receipt.gateAfter.epoch, plan.gate.nextEpoch, "bootstrap activation gate epoch changed unexpectedly");
  const file = fileInRunDir(inputs.runDir, ACTIVATION_RECEIPT_FILE);
  await writeJsonOnce(file, receipt);
  const bytes = await readFile(file);
  await journal.append("activation-receipt-written", {
    receiptSha256: sha256Hex(bytes),
    activationReceiptDigest: receipt.activationReceiptDigest,
    currentDeploymentDigest: receipt.currentDeploymentDigest,
    activeEpoch: receipt.gateAfter.epoch,
  });
  return { receipt, sha256: sha256Hex(bytes) };
}

function safeFinalizedTransactions(journal) {
  return journal.entries
    .filter((entry) => ["finalized", "reconciled-finalized"].includes(entry.event))
    .map((entry) => ({
      stage: entry.stage,
      signature: entry.signature,
      slot: entry.slot,
      blockTime: entry.blockTime,
      feeLamports: entry.feeLamports,
      computeUnits: entry.computeUnits,
      messageSha256: entry.messageSha256,
      wireBytes: entry.wireBytes,
      entrySha256: entry.entrySha256,
    }));
}

async function finalizeHandoffReceipt(inputs, plan, journal, validated) {
  const { state, progress } = validated;
  assert(progress.observation && progress.proposal && progress.receipt, "handoff final evidence is incomplete");
  assert.equal(progress.proposal.state, CeremonyProposalStateV1.Completed, "handoff proposal is not completed");
  assert.equal(state.gate.status, GateStatusV1.EmergencyFrozen, "handoff unexpectedly changed gate status");
  assert.equal(state.gate.epoch.toString(), plan.gate.epoch, "handoff unexpectedly changed gate epoch");
  const receipt = {
    schema: RECEIPT_SCHEMA,
    operationId: plan.operationId,
    planSha256: sha256Hex(Buffer.from(JSON.stringify(plan), "utf8")),
    genesisHash: EXPECTED_GENESIS,
    controllerProgram: CONTROLLER.toBase58(),
    controllerConfig: state.ids.config.toBase58(),
    controllerAuthority: state.ids.authority.toBase58(),
    targetProgram: TARGET.toBase58(),
    targetProgramdata: TARGET_PROGRAMDATA.toBase58(),
    legacyAuthority: LEGACY_AUTHORITY.toBase58(),
    observation: plan.observation.account,
    observationDigest: progress.observation.observationDigest.toString("hex"),
    observationRoot: progress.observation.finalRawMerkleRoot.toString("hex"),
    proposal: plan.handoff.proposal,
    proposalDigest: progress.proposal.proposalDigest.toString("hex"),
    handoffReceipt: plan.handoff.receipt,
    handoffReceiptDigest: progress.receipt.receiptDigest.toString("hex"),
    acceptedSlot: progress.receipt.acceptedSlot.toString(),
    finalObservationSlot: state.slot,
    authorityBefore: LEGACY_AUTHORITY.toBase58(),
    authorityAfter: state.ids.authority.toBase58(),
    programdataPreRawSha256: plan.programdata.preRawSha256,
    programdataPostRawSha256: plan.programdata.postRawSha256,
    artifactSha256: plan.artifact.sha256,
    artifactMerkleRoot: plan.artifact.merkleRoot,
    gateStatus: state.gate.status,
    gateEpoch: state.gate.epoch.toString(),
    targetNonce: state.config.targetNonce.toString(),
    controllerRemainedImmutable: state.controllerProgramdata.authority === null,
    targetNonceConsumed: false,
    gateChanged: false,
    finalizedTransactions: safeFinalizedTransactions(journal),
    accountRawSha256: {
      observation: sha256Hex(progress.accounts[0].data),
      proposal: sha256Hex(progress.accounts[1].data),
      receipt: sha256Hex(progress.accounts[2].data),
      targetProgramdata: sha256Hex(state.targetProgramdata.raw),
    },
    formerAuthorityNegativeTestCompleted: false,
    bootstrapActivationCompleted: false,
    mainnetAllowed: false,
  };
  await writeJsonOnce(fileInRunDir(inputs.runDir, RECEIPT_FILE), receipt);
  await journal.append("handoff-receipt-written", {
    receiptSha256: sha256Hex(Buffer.from(JSON.stringify(receipt), "utf8")),
    acceptedSlot: receipt.acceptedSlot,
    handoffReceiptDigest: receipt.handoffReceiptDigest,
  });
  return receipt;
}

async function executeHandoff() {
  const inputs = await readInputs();
  const plan = await loadPlan(inputs);
  assertPlanInputs(plan, inputs, inputs.rpcConfiguration);
  assertArm(plan);
  await withCeremonyRpcOwnerLock(inputs.runDir, plan.operationId, async () => {
    const journal = await openJournal(inputs.runDir, JOURNAL_NAME, plan.operationId);
    try {
      const rawConnection = new Connection(inputs.rpcConfiguration.stateRpcUrl, FINALIZED_CONNECTION_CONFIG);
      const connection = guardRpcConnection(rawConnection, journal, "spread-handoff-execute");
      await journal.append("session-started", {
        command: "execute-handoff",
        planSha256: sha256Hex(Buffer.from(JSON.stringify(plan), "utf8")),
        mainnetAllowed: false,
      });
      assert.equal(await connection.getGenesisHash(), EXPECTED_GENESIS, "state RPC genesis changed");
      await reconcileJournal(connection, journal, inputs, plan);
      const payer = await loadSecureKeypair(requiredEnvironment("AMEBA_CEREMONY_FEE_PAYER"), PAYER, "ceremony fee payer");
      for (;;) {
        const validated = await validatedLiveState(connection, inputs, plan);
        const action = nextAction(validated, inputs, plan);
        if (action.done) {
          const receipt = await finalizeHandoffReceipt(inputs, plan, journal, validated);
          await journal.append("complete", {
            acceptedSlot: receipt.acceptedSlot,
            receiptDigest: receipt.handoffReceiptDigest,
          });
          process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
          return;
        }
        if (action.pause) {
          await journal.append("timelock-paused", {
            reason: action.pause,
            resumeAtSlot: action.resumeAtSlot,
            observedSlot: validated.state.slot,
            proposalDigest: action.proposalDigest,
          });
          process.stdout.write(`${JSON.stringify({
            schema: "ameba-governance-devnet-spread-handoff-pause-v1",
            operationId: plan.operationId,
            reason: action.pause,
            observedSlot: validated.state.slot,
            resumeAtSlot: action.resumeAtSlot,
            proposalDigest: action.proposalDigest,
            rerunCommand: "execute-handoff",
            planRebuildRequired: false,
          }, null, 2)}\n`);
          return;
        }
        assertStageBlueprint(plan, action);
        await submitAction(connection, journal, inputs, plan, payer, action, validated.state.slot);
      }
    } finally {
      await journal.close();
    }
  });
}

async function statusHandoff() {
  const inputs = await readInputs();
  const plan = await loadPlan(inputs);
  assertPlanInputs(plan, inputs, inputs.rpcConfiguration);
  await withCeremonyRpcOwnerLock(inputs.runDir, plan.operationId, async () => {
    const journal = await openJournal(inputs.runDir, JOURNAL_NAME, plan.operationId);
    try {
      const rawConnection = new Connection(inputs.rpcConfiguration.stateRpcUrl, FINALIZED_CONNECTION_CONFIG);
      const connection = guardRpcConnection(rawConnection, journal, "spread-handoff-status");
      assert.equal(await connection.getGenesisHash(), EXPECTED_GENESIS, "state RPC genesis changed");
      const validated = await validatedLiveState(connection, inputs, plan);
      const action = nextAction(validated, inputs, plan);
      process.stdout.write(`${JSON.stringify({
        schema: "ameba-governance-devnet-spread-handoff-status-v1",
        operationId: plan.operationId,
        observedSlot: validated.state.slot,
        observationStatus: validated.progress.observation?.status ?? null,
        rawCursor: validated.progress.observation?.nextRawChunkIndex ?? null,
        artifactCursor: validated.progress.observation?.nextArtifactChunkIndex ?? null,
        proposalState: validated.progress.proposal?.state ?? null,
        approvalCount: validated.progress.proposal?.approvalCount ?? null,
        next: action.done ? "complete" : action.pause ?? action.stage,
        resumeAtSlot: action.resumeAtSlot ?? null,
        targetAuthority: validated.state.targetProgramdata.authority?.toBase58() ?? null,
        gateStatus: validated.state.gate.status,
        gateEpoch: validated.state.gate.epoch.toString(),
      }, null, 2)}\n`);
    } finally {
      await journal.close();
    }
  });
}

async function executeActivation() {
  const inputs = await readActivationInputs();
  const plan = await loadActivationPlan(inputs);
  const proofEvidence = await loadActivationProofEvidence(inputs, plan);
  assertActivationArm(plan);
  await withCeremonyRpcOwnerLock(inputs.runDir, plan.operationId, async () => {
    const journal = await openJournal(inputs.runDir, activationJournalName(plan.operationId), plan.operationId);
    try {
      const rawConnection = new Connection(inputs.rpcConfiguration.stateRpcUrl, FINALIZED_CONNECTION_CONFIG);
      const connection = guardRpcConnection(rawConnection, journal, "spread-bootstrap-activation-execute");
      await journal.append("session-started", {
        command: "execute-activation",
        planSha256: sha256Hex(Buffer.from(JSON.stringify(plan), "utf8")),
        mainnetAllowed: false,
      });
      assert.equal(await connection.getGenesisHash(), EXPECTED_GENESIS, "state RPC genesis changed");
      let negativeProof = proofEvidence.negativeProof;
      let proofBufferCloseReceipt = proofEvidence.proofBufferCloseReceipt;
      if (!proofBufferCloseReceipt && negativeProof) {
        const priorClose = proofBufferCloseAttempt(journal).prepared;
        if (priorClose) {
          const landed = await pollProofBufferCloseFinalized(connection, journal, priorClose, inputs, plan);
          assert(landed, "proof-buffer Close expired without landing; stop and create a new activation operation");
          const postClose = await readActivationLiveState(connection, inputs, plan, landed.slot, { recovered: true });
          proofBufferCloseReceipt = await writeProofBufferCloseReceipt(
            inputs,
            plan,
            journal,
            negativeProof,
            priorClose,
            landed,
            postClose,
          );
        }
      }
      let validated = await readActivationLiveState(connection, inputs, plan, 0, proofBufferCloseReceipt);
      if (proofEvidence.recovery) {
        const sourceJournal = await openJournal(
          inputs.runDir,
          activationJournalName(proofEvidence.evidencePlan.operationId),
          proofEvidence.evidencePlan.operationId,
        );
        try {
          await verifyNegativeProofLive(
            connection,
            sourceJournal,
            inputs,
            proofEvidence.evidencePlan,
            negativeProof,
            validated,
          );
          await verifyProofBufferCloseReceiptLive(
            connection,
            sourceJournal,
            inputs,
            proofEvidence.evidencePlan,
            negativeProof,
            proofBufferCloseReceipt,
            validated,
          );
        } finally {
          await sourceJournal.close();
        }
      } else if (negativeProof) {
        await verifyNegativeProofLive(connection, journal, inputs, plan, negativeProof, validated);
      }
      if (proofBufferCloseReceipt && !proofEvidence.recovery) {
        await verifyProofBufferCloseReceiptLive(
          connection,
          journal,
          inputs,
          plan,
          negativeProof,
          proofBufferCloseReceipt,
          validated,
        );
      }
      let epochProof = await loadEpochProbeReceipt(inputs, plan);
      if (epochProof) await ensureEpochProbeJournalAnchor(journal, epochProof);
      if (negativeProof && proofBufferCloseReceipt && epochProof) {
        const existing = await loadActivationReceipt(
          inputs,
          plan,
          negativeProof,
          proofBufferCloseReceipt,
          epochProof,
          validated,
        );
        if (existing) {
          assert(validated.progress.receipt && validated.progress.deployment, "local activation receipt exists without finalized on-chain activation");
          await ensureActivationReceiptJournalAnchor(journal, existing);
          process.stdout.write(`${JSON.stringify(existing.receipt, null, 2)}\n`);
          return;
        }
      }
      const payer = await loadSecureKeypair(
        requiredEnvironment("AMEBA_CEREMONY_FEE_PAYER"),
        PAYER,
        "ceremony fee payer",
      );
      if (!negativeProof) {
        negativeProof = await executeNegativeProof(connection, journal, inputs, plan, payer, validated);
        validated = await readActivationLiveState(connection, inputs, plan, negativeProof.finalizedSlot);
        await verifyNegativeProofLive(connection, journal, inputs, plan, negativeProof, validated);
      }
      if (!proofBufferCloseReceipt) {
        proofBufferCloseReceipt = await executeProofBufferClose(
          connection,
          journal,
          inputs,
          plan,
          negativeProof,
          payer,
          validated,
        );
        validated = await readActivationLiveState(
          connection,
          inputs,
          plan,
          proofBufferCloseReceipt.receipt.finalizedSlot,
          proofBufferCloseReceipt,
        );
        await verifyProofBufferCloseReceiptLive(
          connection,
          journal,
          inputs,
          plan,
          negativeProof,
          proofBufferCloseReceipt,
          validated,
        );
      }
      await reconcileActivationJournal(
        connection,
        journal,
        inputs,
        plan,
        negativeProof,
        proofBufferCloseReceipt,
      );
      for (;;) {
        validated = await readActivationLiveState(connection, inputs, plan, 0, proofBufferCloseReceipt);
        const action = nextActivationAction(validated, negativeProof, proofBufferCloseReceipt, plan);
        if (action.done) {
          if (!inputs.postActivationAuthorityDelta) {
            await journal.append("post-activation-authority-delta-required", {
              activationExecutedSlot: validated.progress.proposal?.executedSlot?.toString() ?? null,
              priorPostHandoffReceiptRawSha256: inputs.postHandoffAuthorityDelta.sha256,
              submissionAllowed: false,
            });
            process.stdout.write(`${JSON.stringify({
              schema: "ameba-governance-devnet-bootstrap-activation-evidence-pause-v1",
              operationId: plan.operationId,
              reason: "post-activation-authority-delta-census-required",
              activationExecutedSlot: validated.progress.proposal?.executedSlot?.toString() ?? null,
              requiredEnvironment: "AMEBA_SPREAD_POST_ACTIVATION_AUTHORITY_DELTA_RECEIPT",
              requiredAdapterMode: AUTHORITY_DELTA_MODE,
              requiredAdapterPhase: "post-activation",
              priorPostHandoffReceipt: path.basename(inputs.postHandoffAuthorityDelta.file),
              planRebuildRequired: false,
              submissionAllowed: false,
            }, null, 2)}\n`);
            return;
          }
          assertPostActivationAuthorityDelta(inputs, validated);
          epochProof = await ensureEpochProbeReceipt(
            connection,
            journal,
            inputs,
            plan,
            proofBufferCloseReceipt,
            payer,
            validated,
          );
          validated = await readActivationLiveState(
            connection,
            inputs,
            plan,
            epochProof.receipt.observedSlotAfter,
            proofBufferCloseReceipt,
          );
          const receipt = await finalizeActivationReceipt(
            inputs,
            plan,
            journal,
            negativeProof,
            proofBufferCloseReceipt,
            epochProof,
            validated,
          );
          await journal.append("complete", {
            activationReceiptDigest: receipt.receipt.activationReceiptDigest,
            currentDeploymentDigest: receipt.receipt.currentDeploymentDigest,
            gateEpoch: receipt.receipt.gateAfter.epoch,
            receiptSha256: receipt.sha256,
          });
          process.stdout.write(`${JSON.stringify(receipt.receipt, null, 2)}\n`);
          return;
        }
        if (action.pause) {
          await journal.append("timelock-paused", {
            reason: action.pause,
            resumeAtSlot: action.resumeAtSlot,
            observedSlot: validated.state.slot,
            proposalDigest: action.proposalDigest,
          });
          process.stdout.write(`${JSON.stringify({
            schema: "ameba-governance-devnet-bootstrap-activation-pause-v1",
            operationId: plan.operationId,
            reason: action.pause,
            observedSlot: validated.state.slot,
            resumeAtSlot: action.resumeAtSlot,
            proposalDigest: action.proposalDigest,
            rerunCommand: "execute-activation",
            planRebuildRequired: false,
          }, null, 2)}\n`);
          return;
        }
        assert.notEqual(action.stage, "former-authority-negative", "negative-proof execution unexpectedly remained pending");
        assert.notEqual(action.stage, "former-authority-proof-buffer-close", "proof-buffer Close unexpectedly remained pending");
        await submitActivationAction(
          connection,
          journal,
          inputs,
          plan,
          negativeProof,
          proofBufferCloseReceipt,
          payer,
          action,
          validated.state.slot,
        );
      }
    } finally {
      await journal.close();
    }
  });
}

async function statusActivation() {
  const inputs = await readActivationInputs();
  const plan = await loadActivationPlan(inputs);
  const proofEvidence = await loadActivationProofEvidence(inputs, plan);
  await withCeremonyRpcOwnerLock(inputs.runDir, plan.operationId, async () => {
    const journal = await openJournal(inputs.runDir, activationJournalName(plan.operationId), plan.operationId);
    try {
      const rawConnection = new Connection(inputs.rpcConfiguration.stateRpcUrl, FINALIZED_CONNECTION_CONFIG);
      const connection = guardRpcConnection(rawConnection, journal, "spread-bootstrap-activation-status");
      assert.equal(await connection.getGenesisHash(), EXPECTED_GENESIS, "state RPC genesis changed");
      const negativeProof = proofEvidence.negativeProof;
      const proofBufferCloseReceipt = proofEvidence.proofBufferCloseReceipt;
      const validated = await readActivationLiveState(connection, inputs, plan, 0, proofBufferCloseReceipt);
      let proofJournal = journal;
      if (proofEvidence.recovery) {
        proofJournal = await openJournal(
          inputs.runDir,
          activationJournalName(proofEvidence.evidencePlan.operationId),
          proofEvidence.evidencePlan.operationId,
        );
      }
      try {
        if (negativeProof) {
          await verifyNegativeProofLive(connection, proofJournal, inputs, proofEvidence.evidencePlan, negativeProof, validated);
        }
        if (proofBufferCloseReceipt) {
          await verifyProofBufferCloseReceiptLive(
            connection,
            proofJournal,
            inputs,
            proofEvidence.evidencePlan,
            negativeProof,
            proofBufferCloseReceipt,
            validated,
          );
        }
      } finally {
        if (proofJournal !== journal) await proofJournal.close();
      }
      const epochProof = await loadEpochProbeReceipt(inputs, plan);
      if (epochProof) assertEpochProbeJournal(journal, epochProof);
      const activationReceipt = negativeProof && proofBufferCloseReceipt && epochProof
        ? await loadActivationReceipt(inputs, plan, negativeProof, proofBufferCloseReceipt, epochProof, validated)
        : null;
      if (activationReceipt) {
        assertActivationTransactionJournal(journal, activationReceipt);
        assertActivationReceiptJournal(journal, activationReceipt);
      }
      const action = nextActivationAction(validated, negativeProof, proofBufferCloseReceipt, plan);
      let next;
      let resumeAtSlot = null;
      if (activationReceipt) next = "complete";
      else if (action.pause) {
        next = action.pause;
        resumeAtSlot = action.resumeAtSlot;
      } else if (!action.done) next = action.stage;
      else if (!inputs.postActivationAuthorityDelta) next = "post-activation-authority-delta-census";
      else if (!epochProof) next = "simulate-old-and-current-epochs";
      else next = "write-activation-receipt";
      process.stdout.write(`${JSON.stringify({
        schema: "ameba-governance-devnet-bootstrap-activation-status-v3",
        operationId: plan.operationId,
        observedSlot: validated.state.slot,
        negativeProofCompleted: negativeProof !== null,
        proofBufferCloseCompleted: proofBufferCloseReceipt !== null,
        postHandoffAuthorityDeltaCensusCompleted: inputs.postHandoffAuthorityDelta !== null,
        postActivationAuthorityDeltaCensusCompleted: inputs.postActivationAuthorityDelta !== null,
        observationStatus: validated.progress.observation?.status ?? null,
        rawCursor: validated.progress.observation?.nextRawChunkIndex ?? null,
        artifactCursor: validated.progress.observation?.nextArtifactChunkIndex ?? null,
        proposalState: validated.progress.proposal?.state ?? null,
        approvalCount: validated.progress.proposal?.approvalCount ?? null,
        activationReceiptOnChain: validated.progress.receipt !== null,
        currentDeploymentOnChain: validated.progress.deployment !== null,
        oldAndCurrentEpochSimulationsCompleted: epochProof !== null,
        localActivationReceiptCompleted: activationReceipt !== null,
        next,
        resumeAtSlot,
        targetAuthority: validated.state.targetProgramdata.authority?.toBase58() ?? null,
        gateStatus: validated.state.gate.status,
        gateEpoch: validated.state.gate.epoch.toString(),
        targetNonce: validated.state.config.targetNonce.toString(),
      }, null, 2)}\n`);
    } finally {
      await journal.close();
    }
  });
}

async function selfTest() {
  const runtimeSafety = await selfTestCeremonyRuntime();
  const proofBufferCloseRecoverySafety = await selfTestProofBufferCloseRecovery();
  assert.equal(currentActionObservationSlot({ slot: 123 }, "self-test action"), 123);
  assert.throws(
    () => currentActionObservationSlot({ slot: undefined }, "self-test missing action slot"),
    /observation slot is invalid/u,
  );
  assert.equal(
    FINALIZED_STATUS_POLL_INTERVAL_MS,
    30_000,
    "finalized status polling is faster than 30 seconds",
  );
  assert.deepEqual(
    FINALIZED_CONNECTION_CONFIG,
    { commitment: "finalized", disableRetryOnRateLimit: true },
    "Solana Web3 rate-limit retries are not disabled",
  );
  const ids = derivedIdentities(1n);
  const identityValues = [
    ids.config, ids.authority, ids.gate, ids.policy, ids.council, ids.capacityPolicy,
    ids.immutabilityReceipt, ids.handoffProposal, ids.handoffReceipt,
    ids.activationProposal, ids.activationReceipt, ids.currentDeployment,
  ].map((entry) => entry.toBase58());
  assert.equal(new Set(identityValues).size, identityValues.length, "ceremony PDA roles overlap");
  const negative = directFormerAuthorityUpgradeInstruction(new PublicKey("11111111111111111111111111111112"));
  assert.equal(negative.programId.toBase58(), BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58());
  assert.equal(negative.data.toString("hex"), "03000000");
  assert.deepEqual(negative.keys.map((entry) => ({
    pubkey: entry.pubkey.toBase58(),
    signer: entry.isSigner,
    writable: entry.isWritable,
  })), [
    { pubkey: TARGET_PROGRAMDATA.toBase58(), signer: false, writable: true },
    { pubkey: TARGET.toBase58(), signer: false, writable: true },
    { pubkey: "11111111111111111111111111111112", signer: false, writable: true },
    { pubkey: TREASURY.toBase58(), signer: false, writable: true },
    { pubkey: SYSVAR_RENT_PUBKEY.toBase58(), signer: false, writable: false },
    { pubkey: SYSVAR_CLOCK_PUBKEY.toBase58(), signer: false, writable: false },
    { pubkey: LEGACY_AUTHORITY.toBase58(), signer: true, writable: false },
  ]);
  const close = directFormerAuthorityCloseBufferInstruction(new PublicKey("11111111111111111111111111111112"));
  assert.equal(close.programId.toBase58(), BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58());
  assert.equal(close.data.toString("hex"), "05000000");
  assert.deepEqual(close.keys.map((entry) => ({
    pubkey: entry.pubkey.toBase58(),
    signer: entry.isSigner,
    writable: entry.isWritable,
  })), [
    { pubkey: "11111111111111111111111111111112", signer: false, writable: true },
    { pubkey: TREASURY.toBase58(), signer: false, writable: true },
    { pubkey: LEGACY_AUTHORITY.toBase58(), signer: true, writable: false },
  ]);
  const closeReceiptVector = Object.fromEntries(
    PROOF_BUFFER_CLOSE_RECEIPT_KEYS.map((key) => [key, key === "receiptSha256" ? "" : null]),
  );
  closeReceiptVector.receiptSha256 = proofBufferCloseReceiptSha256(closeReceiptVector);
  assertLowerHash(closeReceiptVector.receiptSha256, "proof-buffer Close receipt self-test digest");
  assert.equal(closeReceiptVector.receiptSha256, proofBufferCloseReceiptSha256(closeReceiptVector));
  const canonicalFixture = { b: 1, a: { d: 2, c: 3 }, receiptSha256: "" };
  assert.equal(compactCanonicalJson(canonicalFixture), '{"a":{"c":3,"d":2},"b":1,"receiptSha256":""}');
  assert.equal(
    semanticJsonHash(POSTSTATE_REPEAT_RECEIPT_DOMAIN, canonicalFixture, "receiptSha256"),
    "73c17bb0304012dfd0cd69642080b2945df40817899eeb2ed2d05ea5d040ee0d",
    "poststate repeat canonical semantic hash vector changed",
  );
  assert.equal(
    semanticJsonHash(BRIDGE_UPGRADE_RECEIPT_DOMAIN, canonicalFixture, "receiptSha256"),
    "f9c51227783747343715072af6490c6e2677aba7374fd4dd9754f09da2233a23",
    "bridge wrapper canonical semantic hash vector changed",
  );
  assert.equal(
    assertCanonicalBasename("spread-bridge-poststate-repeat-attempt-0001-census.json", POSTSTATE_REPEAT_CENSUS_PATTERN, "repeat self-test census")[1],
    "0001",
  );
  assert.equal(
    EXPECTED_HISTORICAL_BRIDGE_RECEIPT_ADAPTER_SHA256,
    "a66eb9a120386992f4e45cbbbb095d701f938c986959a05de6f07060035f33a0",
  );
  const bridgeReceiptHashFixture = Object.fromEntries(
    BRIDGE_UPGRADE_RECEIPT_HASH_KEY_ORDER.map((field, index) => [field, index]),
  );
  assert.equal(
    bridgeUpgradeReceiptHash(bridgeReceiptHashFixture),
    "5c9539ffac1f2d589216567e2246795c9a1f8c027637d4c5f4a1a6d3360e90e7",
    "historical bridge receipt hash parity vector changed",
  );
  assert.equal(
    bridgeUpgradeReceiptHash(Object.fromEntries(Object.entries(bridgeReceiptHashFixture).reverse())),
    "5c9539ffac1f2d589216567e2246795c9a1f8c027637d4c5f4a1a6d3360e90e7",
    "historical bridge receipt hash depends on insertion order",
  );
  assert.notEqual(
    bridgeUpgradeReceiptHash({ ...bridgeReceiptHashFixture, artifactBytes: 999 }),
    "5c9539ffac1f2d589216567e2246795c9a1f8c027637d4c5f4a1a6d3360e90e7",
    "historical bridge receipt hash did not bind a mutation",
  );
  const missingBridgeReceiptField = { ...bridgeReceiptHashFixture };
  delete missingBridgeReceiptField.artifactBytes;
  assert.throws(() => bridgeUpgradeReceiptHash(missingBridgeReceiptField), /keys changed/u);
  assert.throws(
    () => bridgeUpgradeReceiptHash({ ...bridgeReceiptHashFixture, unexpected: true }),
    /keys changed/u,
  );
  const pythonCanonicalFixture = Buffer.from(
    "{\n  \"a\": 1,\n  \"marketCompatibility\": {\n    \"accountAtoms\": 9007199254740993,\n    \"nested\": [\n      {\n        \"a\": true,\n        \"b\": \"value\"\n      }\n    ]\n  },\n  \"z\": null\n}\n",
    "utf8",
  );
  assert.equal(
    compactPythonCanonicalTopLevelMember(
      pythonCanonicalFixture,
      "marketCompatibility",
      "Python-canonical self-test",
    ),
    "{\"accountAtoms\":9007199254740993,\"nested\":[{\"a\":true,\"b\":\"value\"}]}",
    "Python-canonical lexical parsing lost a wide integer or changed structure",
  );
  assert.throws(
    () => compactPythonCanonicalTopLevelMember(
      Buffer.from("{\"z\":null,\"a\":1,\"marketCompatibility\":{}}\n", "utf8"),
      "marketCompatibility",
      "unordered Python-canonical self-test",
    ),
    /not Python-canonical/u,
  );
  assert.throws(
    () => compactPythonCanonicalTopLevelMember(
      Buffer.from("{\"a\":1,\"a\":2,\"marketCompatibility\":{}}\n", "utf8"),
      "marketCompatibility",
      "duplicate Python-canonical self-test",
    ),
    /duplicated or not Python-canonical/u,
  );
  const mutatorProbe = frozenGateProbeInstruction(
    { byte: 17, default_class: "RecognizedMutating" },
    42n,
    ids.gate,
  );
  assert.equal(mutatorProbe.data.length, 17, "frozen mutator probe does not carry exactly one tag plus the signed epoch tail");
  assert.equal(mutatorProbe.data[0], 17);
  assert(mutatorProbe.data.subarray(1).equals(governanceTail(42n)), "frozen mutator probe tail changed");
  assert.deepEqual(mutatorProbe.keys.map((entry) => ({
    pubkey: entry.pubkey.toBase58(), signer: entry.isSigner, writable: entry.isWritable,
  })), [{ pubkey: ids.gate.toBase58(), signer: false, writable: false }]);
  const unknownProbe = frozenGateProbeInstruction(
    { byte: 200, default_class: "Unknown" },
    42n,
    ids.gate,
  );
  assert.equal(unknownProbe.data.toString("hex"), "c8", "unknown-tag probe was enveloped");
  assert.deepEqual(unknownProbe.keys.map((entry) => ({
    pubkey: entry.pubkey.toBase58(), signer: entry.isSigner, writable: entry.isWritable,
  })), [{ pubkey: SystemProgram.programId.toBase58(), signer: false, writable: false }]);
  const frozenDigestVector = Object.fromEntries(
    FROZEN_GATE_CENSUS_KEYS.map((key) => [key, key === "receiptSha256" ? "" : null]),
  );
  frozenDigestVector.receiptSha256 = frozenGateCensusReceiptSha256(frozenDigestVector);
  assertLowerHash(frozenDigestVector.receiptSha256, "frozen-gate census self-test digest");
  assert.equal(frozenDigestVector.receiptSha256, frozenGateCensusReceiptSha256(frozenDigestVector));
  const runwayState = {
    slot: 100,
    config: { voteReviewSlots: 10n, majorDelaySlots: 20n },
    council: {
      seats: Array.from({ length: 5 }, () => ({ active: true, termStartSlot: 0n, termEndSlot: 20_000n })),
    },
  };
  const runway = approvalSeatRunway(runwayState, 2, 3, "self-test two-cycle runway");
  assert.equal(runway.cycleCount, 2);
  assert.equal(runway.requiredTermEndSlot, "10227");
  assertApprovalSeatRunway({ governance: { approvalSeatRunway: runway } }, runwayState, "self-test runway");
  const shortRunwayState = structuredClone(runwayState);
  shortRunwayState.council.seats[0].termEndSlot = BigInt(runway.requiredTermEndSlot);
  assert.throws(
    () => assertApprovalSeatRunway({ governance: { approvalSeatRunway: runway } }, shortRunwayState, "self-test short runway"),
    /does not cover|term changed/u,
  );
  const recovery = {
    source: {
      file: "C:/ceremony/spread-bootstrap-activation-plan-v3.json",
      plan: { operationId: "11".repeat(32) },
      sha256: "22".repeat(32),
    },
    negativeSha256: "33".repeat(32),
    close: {
      sha256: "44".repeat(32),
      receipt: { receiptSha256: "55".repeat(32), finalizedSlot: 123 },
    },
  };
  const recoveryPlan = {
    negative: {
      proofBufferClosedBeforePlanning: true,
      recoverySourcePlanFile: "spread-bootstrap-activation-plan-v3.json",
      recoverySourcePlanOperationId: recovery.source.plan.operationId,
      recoverySourcePlanRawSha256: recovery.source.sha256,
      recoveryNegativeProofRawSha256: recovery.negativeSha256,
      recoveryCloseReceiptRawSha256: recovery.close.sha256,
      recoveryCloseReceiptSha256: recovery.close.receipt.receiptSha256,
      recoveryCloseFinalizedSlot: recovery.close.receipt.finalizedSlot,
    },
  };
  assertActivationRecoveryBindings(recoveryPlan, recovery);
  assert.throws(
    () => assertActivationRecoveryBindings(
      { negative: { ...recoveryPlan.negative, recoveryNegativeProofRawSha256: "66".repeat(32) } },
      recovery,
    ),
    /negative proof changed/u,
  );
  const baselineRaw = Buffer.alloc(PROGRAMDATA_HEADER_LEN + 8);
  baselineRaw.writeUInt32LE(3, 0);
  baselineRaw[12] = 1;
  LEGACY_AUTHORITY.toBuffer().copy(baselineRaw, 13);
  const currentRaw = Buffer.from(baselineRaw);
  ids.authority.toBuffer().copy(currentRaw, 13);
  const changedByteCount = Array.from({ length: 32 }, (_, index) => index)
    .filter((index) => baselineRaw[13 + index] !== currentRaw[13 + index]).length;
  assertAuthorityDeltaProgramdataBytes(baselineRaw, currentRaw, { authorityDelta: { changedByteCount } });
  const mutatedPayload = Buffer.from(currentRaw);
  mutatedPayload[PROGRAMDATA_HEADER_LEN] = 1;
  assert.throws(
    () => assertAuthorityDeltaProgramdataBytes(baselineRaw, mutatedPayload, { authorityDelta: { changedByteCount } }),
    /payload bytes/u,
  );
  const oldProbe = harmlessGovernedSpreadProbe(41n, ids.gate);
  const currentProbe = harmlessGovernedSpreadProbe(42n, ids.gate);
  assert.equal(oldProbe.data.toString("hex"), "02000000000041475631010000002900000000000000");
  assert.equal(currentProbe.data.toString("hex"), "02000000000041475631010000002a00000000000000");
  for (const probe of [oldProbe, currentProbe]) {
    assert.equal(probe.programId.toBase58(), TARGET.toBase58());
    assert.equal(probe.keys.length, 1);
    assert(probe.keys[0].pubkey.equals(ids.gate));
    assert.equal(probe.keys[0].isSigner, false);
    assert.equal(probe.keys[0].isWritable, false);
    const packet = normalizedPacket([probe], [PAYER]);
    assert(packet.packetBytes <= MAX_PACKET_BYTES);
  }
  assertIncorrectAuthorityFailure(
    { InstructionError: [0, "IncorrectAuthority"] },
    ["Program log: Incorrect authority provided"],
    "self-test negative failure",
  );
  assertCustomInstructionError({ InstructionError: [0, { Custom: 6264 }] }, 6264, "self-test stale epoch");
  assertCustomInstructionError({ InstructionError: [0, { Custom: 6001 }] }, 6001, "self-test current epoch");
  const toolSha256 = sha256Hex(await readFile(fileURLToPath(import.meta.url)));
  process.stdout.write(`${JSON.stringify({
    schema: "ameba-governance-devnet-spread-handoff-self-test-v1",
    selfTest: "passed",
    toolSha256,
    controllerProgram: CONTROLLER.toBase58(),
    targetProgram: TARGET.toBase58(),
    controllerAuthority: ids.authority.toBase58(),
    protocolGate: ids.gate.toBase58(),
    finalizedStatusPollIntervalMs: FINALIZED_STATUS_POLL_INTERVAL_MS,
    web3RateLimitRetriesDisabled: FINALIZED_CONNECTION_CONFIG.disableRetryOnRateLimit,
    sharedCeremonyRpcOwnerLock: runtimeSafety.ceremonyRpcOwnerLockName,
    runtimeFinalizedTransactionPollIntervalMs: runtimeSafety.finalizedTransactionPollIntervalMs,
    runtimeMinimumRpcRateLimitBackoffMs: runtimeSafety.minimumRpcRateLimitBackoffMs,
    firstRateLimitCallCount: runtimeSafety.firstRateLimitCallCount,
    proofBufferCloseInstructionDataHex: close.data.toString("hex"),
    proofBufferCloseReceiptDigestVector: closeReceiptVector.receiptSha256,
    proofBufferCloseUnchangedPrestateExpires: proofBufferCloseRecoverySafety.unchangedPrestateExpires,
    proofBufferCloseLandedPoststateRetainsPreparedHistory: proofBufferCloseRecoverySafety.landedPoststateRetainsPreparedHistory,
    proofBufferCloseStaleObservationRejected: proofBufferCloseRecoverySafety.staleObservationRejected,
    proofBufferCloseStaleFinalizedSlotRejected: proofBufferCloseRecoverySafety.staleFinalizedSlotRejected,
    proofBufferCloseTamperedPreparedRejected: proofBufferCloseRecoverySafety.tamperedPreparedRejected,
    proofBufferCloseMalformedDriftRejected: proofBufferCloseRecoverySafety.malformedDriftRejected,
    handoffAndActivationPreSubmitSlotsPropagated: true,
    compatibilityAdapterSha256: EXPECTED_HISTORICAL_BRIDGE_RECEIPT_ADAPTER_SHA256,
    frozenGateCensusReceiptDigestVector: frozenDigestVector.receiptSha256,
    twoCycleSeatRunwayRequiredTermEndSlot: runway.requiredTermEndSlot,
    activationRecoveryEvidenceMutationRejected: true,
    authorityDeltaPayloadMutationRejected: true,
    poststateRepeatReceiptDigestVector: "73c17bb0304012dfd0cd69642080b2945df40817899eeb2ed2d05ea5d040ee0d",
    ambiguousPreparedTransactionsResubmitted: runtimeSafety.ambiguousPreparedTransactionSendCalls !== 0,
    ambiguousPreparedTransactionRequiresReplan: runtimeSafety.ambiguousPreparedTransactionRequiresReplan,
    rpcCalled: false,
    signerAccessed: false,
    submitted: false,
  }, null, 2)}\n`);
}

async function verifyEvidenceOffline() {
  const inputs = await readInputs({ rpc: false });
  const bridge = inputs.bridgeEvidence;
  process.stdout.write(`${JSON.stringify({
    schema: "ameba-governance-devnet-spread-handoff-evidence-verification-v1",
    ok: true,
    genesisHash: EXPECTED_GENESIS,
    controllerProgram: CONTROLLER.toBase58(),
    controllerAuthority: derivedIdentities().authority.toBase58(),
    targetProgram: TARGET.toBase58(),
    targetProgramdata: TARGET_PROGRAMDATA.toBase58(),
    legacyAuthority: LEGACY_AUTHORITY.toBase58(),
    artifactSha256: inputs.artifactSha256,
    bridgeUpgradeReceiptRawSha256: bridge.wrapper.sha256,
    bridgeUpgradeReceiptSha256: bridge.wrapper.value.receiptSha256,
    poststateRepeatReceiptRawSha256: bridge.repeatReceipt.sha256,
    poststateRepeatReceiptSha256: bridge.repeatReceipt.value.receiptSha256,
    formerAuthorityProofBuffer: bridge.proofBuffer.toBase58(),
    formerAuthorityProofBufferRawSha256: bridge.wrapper.value.formerAuthorityProofBufferRawSha256,
    historyVerifiedThroughSlot: bridge.repeatReceipt.value.historyExclusion.throughInclusiveSlot,
    historicalCompatibilityAdapterSha256: EXPECTED_HISTORICAL_BRIDGE_RECEIPT_ADAPTER_SHA256,
    rpcCalled: false,
    signerAccessed: false,
    submitted: false,
  }, null, 2)}\n`);
}

function usage() {
  return `usage:
  node devnet-spread-handoff.mjs plan-handoff
  node devnet-spread-handoff.mjs execute-handoff
  node devnet-spread-handoff.mjs status-handoff
  node devnet-spread-handoff.mjs plan-activation
  node devnet-spread-handoff.mjs execute-activation
  node devnet-spread-handoff.mjs status-activation
  node devnet-spread-handoff.mjs verify-evidence-offline
  node devnet-spread-handoff.mjs self-test

Required secure-file environment:
  AMEBA_RPC_ENV_FILE
  AMEBA_CEREMONY_RUN_DIR
  AMEBA_SPREAD_BRIDGE_ARTIFACT
  AMEBA_SPREAD_BRIDGE_SOURCE_EVIDENCE
  AMEBA_SPREAD_BRIDGE_BUILD_INPUTS_EVIDENCE
  AMEBA_SPREAD_BRIDGE_PACKAGE_EVIDENCE
  AMEBA_SPREAD_BRIDGE_RELEASE_MANIFEST
  AMEBA_SPREAD_PHASE3_INSTRUCTION_MANIFEST
  AMEBA_SPREAD_BRIDGE_RUN_DIR

The bridge run directory must contain the fixed reviewed bridge wrapper, its
three authoritative first-post files, and the independently captured fixed
poststate-repeat receipt plus its named census and ProgramData raw snapshot.

Activation planning/status additionally require:
  AMEBA_SPREAD_BRIDGE_PROOF_BUFFER_ADDRESS
  AMEBA_SPREAD_POST_HANDOFF_AUTHORITY_DELTA_RECEIPT

After activation is finalized, its local receipt remains fail-closed until a
fresh post-activation receipt is supplied as:
  AMEBA_SPREAD_POST_ACTIVATION_AUTHORITY_DELTA_RECEIPT

If the proof buffer was already closed by a prior approved activation attempt,
replan from its immutable evidence by supplying:
  AMEBA_BOOTSTRAP_ACTIVATION_SOURCE_PLAN
and execute/status the new operation-specific plan with:
  AMEBA_BOOTSTRAP_ACTIVATION_PLAN

Execution additionally requires only the public PEM files named by the fixed
KMS allowlist, AMEBA_CEREMONY_FEE_PAYER, and the exact arm printed by the plan.
A local keypair is accepted only for the fixed fee payer; there is no seat or
legacy-authority keypair fallback. Epoch probes are simulation-only and are
never submitted. Activation executes the finalized former-authority negative
test, then one exact Loader-v3 Close of only the proof buffer to the canonical
spill treasury, and refuses council activation until that close receipt and the
buffer's absence are independently re-read.`;
}

try {
  const command = process.argv[2];
  if (command === "plan-handoff") await planHandoff();
  else if (command === "execute-handoff") await executeHandoff();
  else if (command === "status-handoff") await statusHandoff();
  else if (command === "plan-activation") await planActivation();
  else if (command === "execute-activation") await executeActivation();
  else if (command === "status-activation") await statusActivation();
  else if (command === "verify-evidence-offline") await verifyEvidenceOffline();
  else if (command === "self-test") await selfTest();
  else if (command === "--help" || command === "-h") process.stdout.write(`${usage()}\n`);
  else throw new Error(usage());
} catch (error) {
  if (error instanceof RpcBackoffExit) {
    process.stderr.write(`${JSON.stringify({
      schema: "ameba-governance-devnet-rpc-backoff-v1",
      retryAfterMs: error.retryAfterMs,
      messageSha256: sha256Hex(Buffer.from(error.message, "utf8")),
    })}\n`);
    process.exitCode = 75;
  } else {
    throw error;
  }
}
