import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import {
  BUFFER_VERIFICATION_V1_LEN,
  CHECKPOINT_ATTESTATION_V1_LEN,
  COUNCIL_ROTATION_PROPOSAL_V1_LEN,
  EMERGENCY_FREEZE_OBSERVATION_V1_LEN,
  EMERGENCY_FREEZE_RESOLUTION_V1_LEN,
  PROGRAMDATA_FAILURE_OBSERVATION_V1_LEN,
  PROGRAMDATA_VERIFICATION_V1_LEN,
  STATE_CHECKPOINT_V1_LEN,
  UPGRADE_PROPOSAL_V2_LEN,
} from "./release1.js";
import {
  CONTROLLER_CONFIG_LEN,
  GOVERNANCE_COUNCIL_SET_LEN,
  GOVERNANCE_POLICY_LEN,
  PROTOCOL_GATE_LEN,
  UPGRADE_PROPOSAL_LEN,
} from "./v1.js";
import {
  assertClusterDomainV1,
  assertProductionControllerIdentityV1,
  assertRelease1PlanFreshV1,
  isGovernanceSecretFieldV1,
  type Release1ProposalPlanV1,
} from "./release1Planning.js";
import {
  OPERATOR_MUTATION_COMMANDS_V1,
  OperatorBackoffExitV1,
  executeGovernanceMutationV1,
  type ExclusiveOperatorLockV1,
  type ExecuteGovernanceMutationV1Input,
  type FinalizedGovernanceReadAdapterV1,
  type GovernanceJournalV1,
  type OperatorMutationCommandV1,
} from "./operator.js";
import {
  verifyGovernedUpgradeReceiptV3AgainstFinalizedSource,
  type GovernedUpgradeReceiptV3Verification,
  type ReceiptFinalizedSourceReaderV3,
} from "./receiptV3.js";

export const UPGRADE_GOVERNANCE_CLI_COMMANDS_V1 = Object.freeze([
  "schema",
  "observe",
  "plan-initialize",
  "plan-proposal",
  "adopt-buffer",
  "verify-buffer",
  "approve",
  "finalize-governance",
  "queue",
  "guardian-freeze",
  "plan-emergency-resolution",
  "create-emergency-resolution",
  "approve-emergency-resolution",
  "queue-emergency-resolution",
  "execute-emergency-resolution",
  "freeze",
  "bind-prestate",
  "approve-checkpoint",
  "execute-extension",
  "execute-upgrade",
  "verify-programdata",
  "bind-poststate",
  "approve-unfreeze",
  "unfreeze",
  "cancel",
  "expire",
  "close-buffer",
  "plan-rollback",
  "observe-programdata-failure",
  "activate-rollback",
  "create-council-set",
  "rotate-council",
  "plan-controller-immutability",
  "plan-authority-handoff",
  "verify-handoff",
] as const);
export type UpgradeGovernanceCliCommandV1 =
  (typeof UPGRADE_GOVERNANCE_CLI_COMMANDS_V1)[number];

export const RELEASE1_PLANNING_ONLY_COMMANDS_V1 = Object.freeze([
  "plan-initialize",
  "plan-proposal",
  "plan-emergency-resolution",
  "plan-rollback",
  "plan-controller-immutability",
  "plan-authority-handoff",
] as const);
export type Release1PlanningOnlyCommandV1 =
  (typeof RELEASE1_PLANNING_ONLY_COMMANDS_V1)[number];

export const RELEASE1_PHASE7_READINESS_ONLY_COMMANDS_V1 = Object.freeze([
  "plan-controller-immutability",
  "plan-authority-handoff",
  "verify-handoff",
] as const);

export const RELEASE1_PUBLIC_SCHEMA_V1 = Object.freeze({
  schemaVersion: 1,
  accountLengths: Object.freeze({
    ControllerConfigV1: CONTROLLER_CONFIG_LEN,
    GovernancePolicyV1: GOVERNANCE_POLICY_LEN,
    GovernanceCouncilSetV1: GOVERNANCE_COUNCIL_SET_LEN,
    ProtocolGateV1: PROTOCOL_GATE_LEN,
    UpgradeProposalV1: UPGRADE_PROPOSAL_LEN,
    UpgradeProposalV2: UPGRADE_PROPOSAL_V2_LEN,
    BufferVerificationV1: BUFFER_VERIFICATION_V1_LEN,
    ProgramDataVerificationV1: PROGRAMDATA_VERIFICATION_V1_LEN,
    StateCheckpointV1: STATE_CHECKPOINT_V1_LEN,
    CouncilRotationProposalV1: COUNCIL_ROTATION_PROPOSAL_V1_LEN,
    EmergencyFreezeResolutionV1: EMERGENCY_FREEZE_RESOLUTION_V1_LEN,
    EmergencyFreezeObservationV1: EMERGENCY_FREEZE_OBSERVATION_V1_LEN,
    ProgramDataFailureObservationV1: PROGRAMDATA_FAILURE_OBSERVATION_V1_LEN,
    CheckpointAttestationV1: CHECKPOINT_ATTESTATION_V1_LEN,
  }),
  instructionTags: Object.freeze({
    InitializeControllerV1: 1,
    CreateProposalV2: 2,
    ApproveProposalV2: 3,
    FinalizeGovernanceV2: 4,
    QueueProposalV2: 5,
    FreezeProposalV2: 6,
    CancelProposalV2: 7,
    ExpireProposalV2: 8,
    GuardianFreezeV1: 9,
    CreateEmergencyResolutionV1: 10,
    ApproveEmergencyResolutionV1: 11,
    QueueEmergencyResolutionV1: 12,
    ExecuteEmergencyResolutionV1: 13,
    ConvertEmergencyFreezeV2: 14,
    CreateCheckpointAttestationV1: 15,
    RecastCheckpointAttestationV1: 16,
    FinalizeCheckpointV1: 17,
    CreateCandidateCouncilSetV1: 18,
    CreateCouncilRotationV1: 19,
    ApproveCouncilRotationV1: 20,
    ActivateCouncilRotationV1: 21,
    QueueCouncilRotationV1: 22,
    ExpireEmergencyResolutionV1: 23,
    CancelCouncilRotationV1: 24,
    ExpireCouncilRotationV1: 25,
    ReservedCancelEmergencyResolutionV2: 26,
    AdoptBufferV1: 27,
    VerifyBufferChunkV1: 28,
    FinalizeBufferVerificationV1: 29,
    ExtendTargetV1: 30,
    ExecuteUpgradeV1: 31,
    VerifyProgramDataChunkV1: 32,
    FinalizeProgramDataVerificationV1: 33,
    ApproveUnfreezeV1: 34,
    ExecuteUnfreezeV1: 35,
    CloseAbandonedBufferV1: 36,
    ActivateRollbackV1: 37,
    ObserveProgramDataFailureV1: 38,
  }),
  rejectedInstructionTags: Object.freeze([0, 26]),
  council: Object.freeze({ seats: 5, routineQuorum: 3, terminalQuorumReserved: 4 }),
  tokenGovernanceEnabled: false,
  executionSurface: "injected-only",
  phase7ReadinessOnly: RELEASE1_PHASE7_READINESS_ONLY_COMMANDS_V1,
});

export interface UpgradeGovernanceCliPlannerV1 {
  plan(
    command: Release1PlanningOnlyCommandV1 | OperatorMutationCommandV1,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<Release1ProposalPlanV1>;
}

type MutationDependenciesV1 = Omit<
  ExecuteGovernanceMutationV1Input,
  "command" | "plan" | "armOperationId"
>;

export interface UpgradeGovernanceCliAdaptersV1 {
  readAdapter: FinalizedGovernanceReadAdapterV1;
  /** Read-only finalized source used by the built-in independent receipt and
   * handoff verifier. An adapter supplies observations, never a verdict. */
  receiptFinalizedSourceReader: ReceiptFinalizedSourceReaderV3;
  planner: UpgradeGovernanceCliPlannerV1;
  createPlanningSafety(
    command: UpgradeGovernanceCliCommandV1,
    payload: Readonly<Record<string, unknown>>,
    planningOperationId: string,
  ): { journal: GovernanceJournalV1; lock: ExclusiveOperatorLockV1 };
  createMutationDependencies(
    command: OperatorMutationCommandV1,
    plan: Release1ProposalPlanV1,
  ): Promise<MutationDependenciesV1>;
}

interface ParsedCliV1 {
  command: UpgradeGovernanceCliCommandV1;
  armOperationId?: string;
  payload: Readonly<Record<string, unknown>>;
}

function rejectSecretMaterial(value: unknown, path = "payload"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectSecretMaterial(entry, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [field, entry] of Object.entries(value)) {
    if (isGovernanceSecretFieldV1(field)) throw new Error(`${path}.${field} is forbidden; signer material must be injected`);
    rejectSecretMaterial(entry, `${path}.${field}`);
  }
}

function parseCli(argv: readonly string[]): ParsedCliV1 {
  const [rawCommand, ...flags] = argv;
  if (
    rawCommand === undefined ||
    !(UPGRADE_GOVERNANCE_CLI_COMMANDS_V1 as readonly string[]).includes(rawCommand)
  ) {
    throw new Error("unknown or missing upgrade-governance command");
  }
  let armOperationId: string | undefined;
  let payload: Readonly<Record<string, unknown>> = Object.freeze({});
  let payloadSeen = false;
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index]!;
    const equalsIndex = flag.indexOf("=");
    const name = equalsIndex === -1 ? flag : flag.slice(0, equalsIndex);
    const inline = equalsIndex === -1 ? undefined : flag.slice(equalsIndex + 1);
    if (name !== "--arm" && name !== "--payload-json") throw new Error(`unknown CLI option ${name}`);
    const value = inline ?? flags[++index];
    if (value === undefined || value.startsWith("--")) throw new Error(`${name} requires a value`);
    if (name === "--arm") {
      if (armOperationId !== undefined) throw new Error("--arm may appear only once");
      if (!/^[0-9a-f]{64}$/u.test(value)) throw new Error("--arm must be a lowercase SHA-256 operation ID");
      armOperationId = value;
    } else {
      if (payloadSeen) throw new Error("--payload-json may appear only once");
      payloadSeen = true;
      const parsed = JSON.parse(value) as unknown;
      if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("--payload-json must decode to an object");
      rejectSecretMaterial(parsed);
      payload = Object.freeze(parsed as Record<string, unknown>);
    }
  }
  return { command: rawCommand as UpgradeGovernanceCliCommandV1, armOperationId, payload };
}

function isPlanningOnly(command: UpgradeGovernanceCliCommandV1): command is Release1PlanningOnlyCommandV1 {
  return (RELEASE1_PLANNING_ONLY_COMMANDS_V1 as readonly string[]).includes(command);
}

function isMutation(command: UpgradeGovernanceCliCommandV1): command is OperatorMutationCommandV1 {
  return (OPERATOR_MUTATION_COMMANDS_V1 as readonly string[]).includes(command);
}

function requireClusterDomainHex(payload: Readonly<Record<string, unknown>>): Buffer {
  if (typeof payload.clusterDomainHex !== "string" || !/^[0-9a-f]{64}$/u.test(payload.clusterDomainHex)) {
    throw new Error("payload.clusterDomainHex must be a lowercase 32-byte hex string");
  }
  return Buffer.from(payload.clusterDomainHex, "hex");
}

function canonicalPlanningJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError("CLI planning payload is not JSON encodable");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalPlanningJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([field, entry]) => `${JSON.stringify(field)}:${canonicalPlanningJson(entry)}`)
    .join(",")}}`;
}

export function upgradeGovernanceCliPlanningOperationIdV1(
  command: UpgradeGovernanceCliCommandV1,
  payload: Readonly<Record<string, unknown>>,
): string {
  return createHash("sha256")
    .update("AMOEBA_GOVERNANCE_CLI_PLANNING_V1")
    .update(command)
    .update(canonicalPlanningJson(payload))
    .digest("hex");
}

function cliRateLimit(error: unknown): { retryAfterMs: number } | undefined {
  if (typeof error !== "object" || error === null || !("status" in error) || (error as { status?: unknown }).status !== 429) return undefined;
  const retryAfter = "retryAfterMs" in error ? (error as { retryAfterMs?: unknown }).retryAfterMs : 0;
  return { retryAfterMs: Number.isSafeInteger(retryAfter) && (retryAfter as number) >= 0 ? retryAfter as number : 0 };
}

async function assertPlannedAgainstConnectedCluster(
  plan: Release1ProposalPlanV1,
  adapter: FinalizedGovernanceReadAdapterV1,
  production: boolean,
): Promise<void> {
  assertRelease1PlanFreshV1(plan, plan);
  assertClusterDomainV1(plan.clusterDomain, await adapter.getGenesisHash());
  if (production) assertProductionControllerIdentityV1(plan.controllerProgram);
}

export type UpgradeGovernanceCliResultV1 =
  | { status: "schema"; schema: typeof RELEASE1_PUBLIC_SCHEMA_V1 }
  | { status: "observed"; genesisHash: string; observations: unknown }
  | { status: "planned"; command: Release1PlanningOnlyCommandV1 | OperatorMutationCommandV1; plan: Release1ProposalPlanV1 }
  | { status: "verified"; command: "verify-handoff"; result: GovernedUpgradeReceiptV3Verification }
  | { status: "submitted"; command: OperatorMutationCommandV1; operationId: string; signature: string };

/**
 * Execution-free CLI dispatcher. All reads, planning, signing, and submission
 * capabilities are caller-injected. Merely invoking a mutation command returns
 * an unarmed plan; submission requires an exact explicit `--arm` operation ID.
 */
export async function runUpgradeGovernanceCliV1(
  argv: readonly string[],
  adapters: UpgradeGovernanceCliAdaptersV1,
): Promise<UpgradeGovernanceCliResultV1> {
  const parsed = parseCli(argv);
  if (parsed.command === "schema") {
    if (parsed.armOperationId !== undefined || Object.keys(parsed.payload).length !== 0) throw new Error("schema accepts no options");
    return { status: "schema", schema: RELEASE1_PUBLIC_SCHEMA_V1 };
  }
  const planningOperationId = upgradeGovernanceCliPlanningOperationIdV1(parsed.command, parsed.payload);
  const safety = adapters.createPlanningSafety(parsed.command, parsed.payload, planningOperationId);
  safety.lock.acquire(planningOperationId);
  safety.journal.append(planningOperationId, "planning-started", { command: parsed.command, payload: parsed.payload });
  try {
    let result: UpgradeGovernanceCliResultV1;
    if (parsed.command === "observe") {
      if (parsed.armOperationId !== undefined) throw new Error("observe cannot be armed");
      const clusterDomain = requireClusterDomainHex(parsed.payload);
      const accountValues = parsed.payload.accounts;
      if (!Array.isArray(accountValues) || accountValues.length === 0 || accountValues.some((entry) => typeof entry !== "string")) {
        throw new Error("observe requires a nonempty payload.accounts base58 array");
      }
      const accounts = accountValues.map((entry) => new PublicKey(entry as string));
      if (new Set(accounts.map((entry) => entry.toBase58())).size !== accounts.length) throw new Error("observe account list contains a duplicate");
      const genesisHash = await adapters.readAdapter.getGenesisHash();
      assertClusterDomainV1(clusterDomain, genesisHash);
      const observations = await adapters.readAdapter.observeAccounts(accounts);
      if (observations.length !== accounts.length || observations.some((entry, index) => entry.commitment !== "finalized" || !entry.pubkey.equals(accounts[index]!))) {
        throw new Error("finalized observation adapter returned incomplete or reordered data");
      }
      result = { status: "observed", genesisHash, observations };
    } else if (parsed.command === "verify-handoff") {
      if (parsed.armOperationId !== undefined) throw new Error("verify-handoff is read-only and cannot be armed");
      assertClusterDomainV1(requireClusterDomainHex(parsed.payload), await adapters.readAdapter.getGenesisHash());
      const fields = Object.keys(parsed.payload).sort();
      if (fields.length !== 2 || fields[0] !== "clusterDomainHex" || fields[1] !== "receipt") {
        throw new Error("verify-handoff requires exactly payload.clusterDomainHex and payload.receipt");
      }
      result = {
        status: "verified",
        command: parsed.command,
        result: await verifyGovernedUpgradeReceiptV3AgainstFinalizedSource(
          parsed.payload.receipt,
          adapters.receiptFinalizedSourceReader,
        ),
      };
    } else {
      if (!isPlanningOnly(parsed.command) && !isMutation(parsed.command)) throw new Error("unclassified CLI command");
      if (isPlanningOnly(parsed.command) && parsed.armOperationId !== undefined) {
        throw new Error(`${parsed.command} is planning-only and cannot be armed`);
      }
      const plan = await adapters.planner.plan(parsed.command, parsed.payload);
      await assertPlannedAgainstConnectedCluster(plan, adapters.readAdapter, parsed.payload.production === true);
      if (isPlanningOnly(parsed.command) || parsed.armOperationId === undefined) {
        result = { status: "planned", command: parsed.command, plan };
      } else {
        const dependencies = await adapters.createMutationDependencies(parsed.command, plan);
        const submitted = await executeGovernanceMutationV1({
          ...dependencies,
          command: parsed.command,
          plan,
          armOperationId: parsed.armOperationId,
        });
        result = { status: "submitted", command: parsed.command, operationId: plan.operationId, signature: submitted.signature };
      }
    }
    safety.journal.append(planningOperationId, "planning-completed", { command: parsed.command, status: result.status });
    return result;
  } catch (error) {
    if (error instanceof OperatorBackoffExitV1) throw error;
    const rateLimit = cliRateLimit(error);
    if (rateLimit !== undefined) {
      safety.journal.append(planningOperationId, "rate-limit-exit", {
        status: 429,
        retryAfterMs: rateLimit.retryAfterMs,
        retryAt: new Date(Date.now() + rateLimit.retryAfterMs).toISOString(),
      });
      throw new OperatorBackoffExitV1(rateLimit.retryAfterMs);
    }
    safety.journal.append(planningOperationId, "planning-failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    throw error;
  } finally {
    safety.lock.release();
  }
}

function jsonValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof PublicKey) return value.toBase58();
  if (Buffer.isBuffer(value)) return value.toString("hex");
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([field, entry]) => [field, jsonValue(entry)]));
  return value;
}

export function stringifyUpgradeGovernanceCliResultV1(result: UpgradeGovernanceCliResultV1): string {
  return `${JSON.stringify(jsonValue(result), null, 2)}\n`;
}
