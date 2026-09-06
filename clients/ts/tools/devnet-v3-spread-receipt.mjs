// Read-only finalized verification of the fresh Devnet deployment and its stop boundary.
import assert from "node:assert/strict";
import {
  readFile,
  writeFile,
  open,
  unlink,
  mkdir,
  copyFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import * as v3 from "../dist/upgradeGovernance/governanceV3.js";
import {
  loadDevnetRpcConfiguration,
  requireSecureDirectory,
} from "./secure-rpc-env.mjs";
const run =
  process.env.AMEBA_V3_RUN ||
  "/home/space/.local/state/ameba/spread-v3-devnet-20260905";
await requireSecureDirectory(run, "fresh Spread run");
const hash = (x) => createHash("sha256").update(x).digest("hex");
const json = (x) =>
  JSON.stringify(x, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) +
  "\n";
const load = async (name) =>
  JSON.parse(await readFile(run + "/" + name, "utf8"));
const program = new PublicKey("8fhNi6QHU5TYNhoPDM4vs89ZBztnpxp3LnBXRgkBVKtx"),
  target = new PublicKey("2jVQSPny9eFoaG1ZWoJVAezQ5VgqJtF8rQCQXMktuBVw");
const controllerPlan = await load("controller-plan.json"),
  spreadPlan = await load("spread-plan.json");
const { stateRpcUrl, stateRpcOrigin } = await loadDevnetRpcConfiguration();
async function rpc(method, params = []) {
  const r = await fetch(stateRpcUrl, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!r.ok) {
    await writeFile(
      run + "/receipt-rpc-failure.json",
      json({
        status: r.status,
        retryAfter: r.headers.get("retry-after"),
        backoffSeconds: 60,
        automaticRetry: false,
      }),
      { mode: 0o600 },
    );
    throw Error(`RPC HTTP ${r.status}; no retry`);
  }
  const j = await r.json();
  assert(!j.error, JSON.stringify(j.error));
  return j.result;
}
const lockPath = run + "/release1-devnet-rpc-owner.lock",
  lock = await open(lockPath, "wx", 0o600);
try {
  await lock.writeFile(json({ pid: process.pid, stage: "final-receipt" }));
  assert.equal(await rpc("getGenesisHash"), v3.GOVERNANCE_V3_GENESIS);
  const configKey = v3.deriveConfigV3(program)[0],
    gateKey = v3.deriveTargetGateV3(program, target)[0];
  const proposalKey = v3.deriveProposalV3(
    program,
    BigInt(controllerPlan.proposalId),
  )[0];
  const keys = [
    program,
    v3.deriveProgramdataV3(program),
    configKey,
    proposalKey,
    target,
    v3.deriveProgramdataV3(target),
    gateKey,
    new PublicKey("7CTZKJSkPG6TEbEeB6jweKCBP47GBDcwpqmL5b534jed"),
    new PublicKey("2DBN762WGdNc85xiVdvQX7Lo4TXAq3WhVz9mBQcaU3a3"),
  ];
  const snapshot = await rpc("getMultipleAccounts", [
    keys.map(String),
    { encoding: "base64", commitment: "finalized" },
  ]);
  await writeFile(
    run + "/finalized-snapshot.json",
    json({ keys: keys.map(String), ...snapshot }),
    { mode: 0o600 },
  );
  const b = (i) => Buffer.from(snapshot.value[i].data[0], "base64");
  function verifyProgram(index, expectedAuthority, plan) {
    const p = snapshot.value[index],
      d = snapshot.value[index + 1],
      pb = b(index),
      db = b(index + 1);
    assert.equal(p.owner, v3.LOADER_V3.toBase58());
    assert.equal(d.owner, v3.LOADER_V3.toBase58());
    assert.equal(p.executable, true);
    assert.equal(d.executable, false);
    assert.equal(pb.length, 36);
    assert.equal(pb.readUInt32LE(), 2);
    assert(new PublicKey(pb.subarray(4)).equals(keys[index + 1]));
    assert.equal(db.readUInt32LE(), 3);
    assert.equal(db[12], 1);
    assert(new PublicKey(db.subarray(13, 45)).equals(expectedAuthority));
    assert.equal(db.length, 45 + plan.artifactBytes);
    assert.equal(hash(db.subarray(45)), plan.artifactSha256);
    return {
      programId: keys[index],
      programData: keys[index + 1],
      authority: expectedAuthority,
      deployedSlot: db.readBigUInt64LE(4),
      artifactBytes: plan.artifactBytes,
      artifactSha256: plan.artifactSha256,
      sourceCommit: plan.sourceCommit,
    };
  }
  const controller = verifyProgram(
      0,
      v3.deriveAuthorityV3(program)[0],
      controllerPlan,
    ),
    spread = verifyProgram(
      4,
      v3.deriveTargetAuthorityV3(program, target)[0],
      spreadPlan,
    );
  for (const i of [2, 3, 6]) {
    assert.equal(snapshot.value[i].owner, program.toBase58());
    assert.equal(snapshot.value[i].executable, false);
  }
  const council = v3.decodeConfigV3(program, configKey, b(2)),
    proposal = v3.decodeProposalV3(program, proposalKey, b(3)),
    gate = v3.decodeTargetGateV3(program, target, gateKey, b(6));
  assert.equal(council.timing.reviewSlots, 1512000n);
  assert.equal(council.timing.delaySlots, 4500n);
  assert.equal(council.timing.expirySlots, 2592000n);
  assert.equal(council.councilEpoch, 1n);
  assert.equal(proposal.state, 1);
  assert.equal(proposal.approvalCount, 3);
  assert.equal(proposal.verifiedCount, 12);
  assert.equal(proposal.reviewEnd - proposal.created, 1512000n);
  assert.equal(gate.status, 2);
  assert.equal(gate.epoch, 1n);
  assert.equal(gate.reason, 1);
  assert(gate.lastCompletedProposal.equals(PublicKey.default));
  const owned = await rpc("getProgramAccounts", [
    target.toBase58(),
    { encoding: "base64", commitment: "finalized", withContext: true },
  ]);
  assert.equal(
    owned.value.length,
    0,
    "fresh Spread must have no initialized business accounts",
  );
  assert.equal(snapshot.value[7].owner, v3.LOADER_V3.toBase58());
  assert.equal(b(7)[12], 0, "old controller remains immutable");
  const oldSpreadAuthority = new PublicKey(b(8).subarray(13, 45));
  assert.equal(b(8)[12], 1);
  assert.equal(
    oldSpreadAuthority.toBase58(),
    "CqFREUP84XzdUC6WeDZrzTBXLwnfMQM2K9MvwdhApXt4",
  );
  // Simulation only: exact gate must reject before touching any business account.
  const payer = Keypair.fromSecretKey(
      Uint8Array.from(await load("fee-payer.json")),
    ),
    latest = (await rpc("getLatestBlockhash", [{ commitment: "finalized" }]))
      .value;
  const data = Buffer.concat([
    Buffer.from([2]),
    Buffer.from("AGV1"),
    Buffer.from([1, 0, 0, 0]),
    Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]),
  ]);
  const tx = new Transaction({ feePayer: payer.publicKey, ...latest }).add(
    new TransactionInstruction({
      programId: target,
      keys: [{ pubkey: gateKey, isSigner: false, isWritable: false }],
      data,
    }),
  );
  tx.sign(payer);
  const simulation = await rpc("simulateTransaction", [
    tx.serialize().toString("base64"),
    { encoding: "base64", commitment: "finalized", sigVerify: true },
  ]);
  assert.deepEqual(simulation.value.err, {
    InstructionError: [0, { Custom: 6263 }],
  });
  await writeFile(run + "/live-frozen-gate-simulation.json", json(simulation), {
    mode: 0o600,
  });
  const stageNames = [
    "create-controller",
    "approve-controller",
    "execute-controller",
    "register-spread",
  ];
  const signatures = await Promise.all(
    stageNames.map(async (stage) => ({
      stage,
      ...(await load(stage + "-submitted.json")),
    })),
  );
  const deployed = await load("spread-deploy-result.json");
  assert.equal(deployed.code, 0);
  const deployResult = JSON.parse(deployed.output);
  assert(deployResult.signature);
  signatures.push({
    stage: "deploy-spread",
    signature: deployResult.signature,
  });
  const statuses = await rpc("getSignatureStatuses", [
    signatures.map((s) => s.signature),
    { searchTransactionHistory: true },
  ]);
  statuses.value.forEach((s) => {
    assert(s);
    assert.equal(s.err, null);
    assert.equal(s.confirmationStatus, "finalized");
  });
  const receipt = {
    schema: "ameba-fresh-spread-v3-devnet-receipt-v1",
    verifiedAt: new Date().toISOString(),
    genesis: v3.GOVERNANCE_V3_GENESIS,
    stateRpcOrigin,
    finalizedSlot: snapshot.context.slot,
    controller,
    spread,
    council: {
      config: configKey,
      seats: council.seats,
      threshold: 3,
      councilEpoch: council.councilEpoch,
      timingVersion: council.timingVersion,
      timing: council.timing,
    },
    gate: {
      address: gateKey,
      status: "EmergencyFrozen",
      epoch: gate.epoch,
      freezeSlot: gate.freezeSlot,
      reason: gate.reason,
    },
    controllerUpgrade: {
      proposal: proposalKey,
      created: proposal.created,
      reviewEnd: proposal.reviewEnd,
      notBefore: proposal.notBefore,
      executedSlot: proposal.executedSlot,
      approvalCount: proposal.approvalCount,
      verifiedChunks: proposal.verifiedCount,
    },
    signatures: signatures.map((s, i) => ({
      ...s,
      finalizedSlot: statuses.value[i].slot,
    })),
    stopBoundary: {
      integrated: false,
      activated: false,
      bootstrapped: false,
      migrated: false,
      spreadOwnedAccounts: owned.value.length,
    },
    existingDeployments: {
      controllerImmutable: true,
      spreadAuthority: oldSpreadAuthority,
    },
    verification: {
      rustCoreTests: 4,
      actualSbfRehearsals: [
        "controller self-upgrade",
        "target adoption, extension and upgrade",
        "fresh Spread frozen gate",
      ],
      typescriptTests: 2,
      typescriptBuild: true,
      byteIdenticalRepeatBuilds: true,
      independentCleanBuilds: false,
      liveFrozenGateError: 6263,
      artifactChecks: await load("artifact-checks.json"),
      fullHistoricalReleaseSuite: false,
    },
  };
  await writeFile(run + "/verified-receipt.json", json(receipt), {
    mode: 0o600,
  });
  const dirs = [
    "/mnt/c/Users/space/.codex/worktrees/governance-v3-week-window/ameba_gov/docs/governance/evidence/v3-spread-devnet-20260905",
    "/mnt/c/Users/space/.codex/worktrees/c9e4/ameba_spread/docs/governance/evidence/v3-spread-devnet-20260905",
  ];
  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
    await writeFile(dir + "/receipt.json", json(receipt));
    await writeFile(
      dir + "/README.md",
      `# Fresh Spread under V3 — Devnet\n\n` +
        `Finalized at slot ${snapshot.context.slot}. See [receipt.json](receipt.json) for source, artifact, authority and transaction identities.\n\n` +
        `Spread: \`${target}\`. Controller: \`${program}\`.\n\n` +
        `The existing KMS council controls both programs through a 3-of-5 quorum. Approval windows are at least 1,512,000 slots (about a week); the independent execution delay is 4,500 slots.\n\n` +
        `Spread's gate is EmergencyFrozen at epoch 1. It owns zero business accounts. No business bootstrap, state migration, activation or application integration was performed.\n\n` +
        `Focused checks: four Rust core checks, three actual-SBF rehearsals (self-upgrade, target adoption/extension/upgrade, and the fresh Spread frozen gate), two TypeScript checks, TypeScript compilation, byte-identical repeat builds and finalized chain verification. Repeat builds reused their caches; this does not claim independent clean reproducible builds or completion of the historical production release suite.\n\n` +
        `Controller artifact source: \`${controllerPlan.sourceCommit}\`. Spread artifact source: \`${spreadPlan.sourceCommit}\`. Artifact diagnostics are recorded in [artifact-checks.json](artifact-checks.json).\n`,
    );
    await copyFile(
      run + "/artifact-checks.json",
      dir + "/artifact-checks.json",
    );
  }
  console.log(json(receipt));
} finally {
  await lock.close();
  await unlink(lockPath);
}
