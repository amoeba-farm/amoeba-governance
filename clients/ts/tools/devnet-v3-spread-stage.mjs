// Explicit fresh-Spread Devnet ceremony. One run journal and RPC owner at a time.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  readFile,
  writeFile,
  appendFile,
  open,
  unlink,
} from "node:fs/promises";
import { execFileSync, spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  SystemProgram,
} from "@solana/web3.js";
import bs58 from "bs58";
import * as v3 from "../dist/upgradeGovernance/governanceV3.js";
import {
  artifactMerkleRoot,
  artifactMerkleProof,
} from "../dist/upgradeGovernance/artifactMerkleV1.js";
import {
  loadDevnetRpcConfiguration,
  requireSecureDirectory,
  requireSecureRegularFile,
} from "./secure-rpc-env.mjs";
process.umask(0o077);
const [stage, arg] = process.argv.slice(2);
const run =
  process.env.AMEBA_V3_RUN ||
  "/home/space/.local/state/ameba/spread-v3-devnet-20260905";
await requireSecureDirectory(run, "fresh Spread run");
const root = path.dirname(fileURLToPath(import.meta.url));
const program = new PublicKey("8fhNi6QHU5TYNhoPDM4vs89ZBztnpxp3LnBXRgkBVKtx");
const target = new PublicKey("2jVQSPny9eFoaG1ZWoJVAezQ5VgqJtF8rQCQXMktuBVw");
const oldProgram = "9ipkBCjEfeJDMF6AFrezRmDDHmbnmeyv45cfXNqAnWsH";
const treasury = new PublicKey("8XUjnzVzR71DaVuqbSHaNev5H4vrxofyFP4iZt2FXa1j");
const oldControllerHash =
  "6e48e439f2f3532d5b82505b231aac5e88ffadd462b063a93f78b1c75b6fd4b7";
const json = (x) =>
  JSON.stringify(x, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) +
  "\n";
const hash = (x) => createHash("sha256").update(x).digest("hex");
const save = (name, value) =>
  writeFile(path.join(run, name), json(value), { mode: 0o600 });
const load = async (name) =>
  JSON.parse(await readFile(path.join(run, name), "utf8"));
const exists = async (name) => {
  try {
    await readFile(path.join(run, name));
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
};
const kp = async (name) => {
  await requireSecureRegularFile(path.join(run, name), "Devnet key");
  return Keypair.fromSecretKey(Uint8Array.from(await load(name)));
};
const payer = await kp("fee-payer.json"),
  deployer = await kp("spread-deployer.json");
assert.equal(
  payer.publicKey.toBase58(),
  "G2f6Fv477ZyFbmRFtVr21jf9VufXpiRCxf1e91J6SxxT",
);
assert.equal(
  deployer.publicKey.toBase58(),
  "GFcbEfGvi1j12rEm2eAC4e3TGUaQDJjSVDX9nqGVRf6Q",
);
assert((await kp("spread-program.json")).publicKey.equals(target));
const { stateRpcUrl, stateRpcOrigin } = await loadDevnetRpcConfiguration();
const journal = (x) =>
  appendFile(
    path.join(run, "ceremony.jsonl"),
    json({ ...x, at: new Date().toISOString() }).trim() + "\n",
    { mode: 0o600 },
  );
async function rpc(method, params = []) {
  const r = await fetch(stateRpcUrl, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!r.ok) {
    await save("rpc-failure.json", {
      method,
      status: r.status,
      retryAfter: r.headers.get("retry-after"),
      backoffSeconds: 60,
      automaticRetry: false,
    });
    throw Error(`RPC HTTP ${r.status}; stopped without retry`);
  }
  const j = await r.json();
  if (j.error) throw Error(JSON.stringify(j.error));
  return j.result;
}
async function accounts(keys) {
  return rpc("getMultipleAccounts", [
    keys.map((x) => String(x)),
    { encoding: "base64", commitment: "finalized" },
  ]);
}
function bytes(a) {
  assert(a);
  return Buffer.from(a.data[0], "base64");
}
function pd(a) {
  assert.equal(a.owner, v3.LOADER_V3.toBase58());
  assert.equal(a.executable, false);
  const b = bytes(a);
  assert.equal(b.readUInt32LE(), 3);
  assert.equal(b[12], 1);
  return {
    slot: b.readBigUInt64LE(4),
    authority: new PublicKey(b.subarray(13, 45)),
    capacity: b.length - 45,
    sha256: hash(b.subarray(45)),
  };
}
async function council() {
  const s = await accounts([v3.deriveConfigV3(program)[0]]),
    a = s.value[0];
  assert.equal(a.owner, program.toBase58());
  assert.equal(a.executable, false);
  const c = v3.decodeConfigV3(program, v3.deriveConfigV3(program)[0], bytes(a));
  assert(c.treasury.equals(treasury));
  assert.equal(c.timing.reviewSlots, 1512000n);
  return c;
}
async function proposal() {
  const plan = await load("controller-plan.json");
  const key = v3.deriveProposalV3(program, BigInt(plan.proposalId))[0];
  const s = await accounts([key]);
  assert.equal(s.value[0].owner, program.toBase58());
  return v3.decodeProposalV3(program, key, bytes(s.value[0]));
}
async function confirmed(name, signature) {
  for (let attempt = 0; attempt < 12; attempt++) {
    if (attempt > 0) await delay(30000);
    const s = (
      await rpc("getSignatureStatuses", [
        [signature],
        { searchTransactionHistory: true },
      ])
    ).value[0];
    if (s?.err)
      throw Error(`${name} transaction failed: ${JSON.stringify(s.err)}`);
    if (s?.confirmationStatus === "finalized") {
      await save(`${name}-finalized.json`, { signature, ...s });
      return;
    }
    console.log(
      json({ stage: name, signature, waitingForFinalized: true }).trim(),
    );
  }
  throw Error(`${name} not finalized yet; preserved signed transaction`);
}
async function send(
  name,
  instructions,
  local = [],
  seatIndexes = [],
  treasurySign = false,
) {
  if (await exists(`${name}-submitted.json`)) {
    const s = await load(`${name}-submitted.json`);
    await confirmed(name, s.signature);
    return s.signature;
  }
  if (await exists(`${name}-signed.json`))
    throw Error(`${name} signed journal exists; reconcile before resubmission`);
  if (seatIndexes.length || treasurySign)
    assert(process.env.AMEBA_GCP_KMS_ACCESS_TOKEN, "KMS token required");
  const c = seatIndexes.length ? await council() : null;
  const remote = seatIndexes.map((i) => ({
    key: c.seats[i],
    name: `seat-${i}.pem`,
    resource: `governance-seat-${i + 1}-v1`,
  }));
  if (treasurySign)
    remote.push({
      key: treasury,
      name: "treasury.pem",
      resource: "governance-treasury-v1",
    });
  for (const s of remote)
    if (!(await exists(s.name))) {
      const resource = `projects/amoeba-hm0q2k/locations/global/keyRings/ameba-spread-devnet/cryptoKeys/${s.resource}/cryptoKeyVersions/1`;
      const r = await fetch(
        `https://cloudkms.googleapis.com/v1/${resource}/publicKey`,
        {
          headers: {
            authorization: `Bearer ${process.env.AMEBA_GCP_KMS_ACCESS_TOKEN}`,
          },
          signal: AbortSignal.timeout(20000),
        },
      );
      assert(r.ok, "KMS public key read failed");
      const value = await r.json();
      assert.equal(value.algorithm, "EC_SIGN_ED25519");
      await writeFile(path.join(run, s.name), value.pem, {
        mode: 0o600,
        flag: "wx",
      });
    }
  const latest = (
    await rpc("getLatestBlockhash", [{ commitment: "finalized" }])
  ).value;
  const tx = new Transaction({ feePayer: payer.publicKey, ...latest }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
    ...instructions,
  );
  tx.partialSign(payer, ...local);
  const message = tx.serializeMessage(),
    messageHash = hash(message),
    file = path.join(run, `${name}-message.bin`);
  await writeFile(file, message, { mode: 0o600 });
  for (const s of remote) {
    const resource = `projects/amoeba-hm0q2k/locations/global/keyRings/ameba-spread-devnet/cryptoKeys/${s.resource}/cryptoKeyVersions/1`;
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        [
          path.join(root, "gcp-kms-ed25519-signer.mjs"),
          "--authority",
          s.key.toBase58(),
          "--kms-key-version",
          resource,
          "--public-key-pem",
          path.join(run, s.name),
          "--message",
          file,
          "--expected-message-sha256",
          messageHash,
        ],
        {
          encoding: "utf8",
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 30000,
        },
      ),
    );
    assert.equal(result.messageSha256, messageHash);
    assert.equal(result.authority, s.key.toBase58());
    tx.addSignature(s.key, Buffer.from(result.signatureBase64, "base64"));
  }
  assert(tx.serializeMessage().equals(message));
  assert(tx.verifySignatures());
  const wire = tx.serialize();
  assert(wire.length <= 1232);
  const sim = await rpc("simulateTransaction", [
    wire.toString("base64"),
    { encoding: "base64", commitment: "finalized", sigVerify: true },
  ]);
  await save(`${name}-simulation.json`, sim);
  assert.equal(sim.value.err, null, `${name} simulation failed`);
  const signature = bs58.encode(tx.signature);
  await save(`${name}-signed.json`, {
    signature,
    messageHash,
    wire: wire.toString("base64"),
    ...latest,
  });
  const actual = await rpc("sendTransaction", [
    wire.toString("base64"),
    {
      encoding: "base64",
      preflightCommitment: "finalized",
      skipPreflight: false,
      maxRetries: 0,
    },
  ]);
  assert.equal(actual, signature);
  await save(`${name}-submitted.json`, { signature, messageHash });
  await journal({ stage: name, signature });
  console.log(json({ stage: name, signature, submitted: true }).trim());
  await confirmed(name, signature);
  return signature;
}
async function artifact(which) {
  const b = await readFile(
    path.join(
      run,
      `${which}-deploy`,
      which === "controller"
        ? "governance_controller_v3.so"
        : "light_token_minter.so",
    ),
  );
  assert(b.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])));
  return b;
}
async function bufferMatches(which) {
  const b = await kp(
      `${which === "controller" ? "controller" : "spread"}-buffer.json`,
    ),
    a = await artifact(which);
  const s = await accounts([b.publicKey]);
  const value = s.value[0];
  assert.equal(value.owner, v3.LOADER_V3.toBase58());
  assert.equal(value.executable, false);
  const d = bytes(value);
  assert.equal(d.length, a.length + 37);
  assert.equal(d.readUInt32LE(), 1);
  assert.equal(d[4], 1);
  assert(new PublicKey(d.subarray(5, 37)).equals(deployer.publicKey));
  assert(d.subarray(37).equals(a), "buffer bytes must exactly match");
  return b;
}
const lockFile = path.join(run, "release1-devnet-rpc-owner.lock");
const lock = await open(lockFile, "wx", 0o600);
try {
  await lock.writeFile(
    json({ pid: process.pid, stage, started: new Date().toISOString() }),
  );
  assert.equal(await rpc("getGenesisHash"), v3.GOVERNANCE_V3_GENESIS);
  if (stage === "status") {
    const keys = [
      v3.deriveProgramdataV3(program),
      v3.deriveConfigV3(program)[0],
      target,
      v3.deriveProgramdataV3(target),
      v3.deriveTargetGateV3(program, target)[0],
      payer.publicKey,
      treasury,
      v3.deriveProgramdataV3(new PublicKey(oldProgram)),
    ];
    const s = await accounts(keys);
    await save("status-snapshot.json", { keys: keys.map(String), ...s });
    console.log(
      json({
        slot: s.context.slot,
        controller: pd(s.value[0]),
        spreadExists: !!s.value[2],
        spread: s.value[3] ? pd(s.value[3]) : null,
        gate: s.value[4]
          ? v3.decodeTargetGateV3(program, target, keys[4], bytes(s.value[4]))
          : null,
        payerLamports: s.value[5]?.lamports,
        treasuryLamports: s.value[6]?.lamports,
        oldSpread: pd(s.value[7]),
      }),
    );
  } else if (stage === "cancel-controller") {
    const c = await council(),
      p = await proposal();
    await send(
      "cancel-controller",
      c.seats.slice(0, 3).map((s) => v3.approveV3(c, p, s, true)),
      [],
      [0, 1, 2],
    );
    await send("close-controller-buffer", [
      v3.closeBufferV3(c, await proposal()),
    ]);
  } else if (stage === "extend-top-level") {
    const c = await council(),
      a = await artifact("controller");
    const snap = await accounts([v3.deriveProgramdataV3(program)]),
      before = pd(snap.value[0]);
    assert.equal(before.sha256, oldControllerHash);
    assert(before.authority.equals(c.authority));
    const delta = a.length - before.capacity;
    assert(delta >= 10240);
    const data = Buffer.alloc(8);
    data.writeUInt32LE(6);
    data.writeUInt32LE(delta, 4);
    const ix = new TransactionInstruction({
      programId: v3.LOADER_V3,
      keys: [
        {
          pubkey: v3.deriveProgramdataV3(program),
          isWritable: true,
          isSigner: false,
        },
        { pubkey: program, isWritable: true, isSigner: false },
        { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
        { pubkey: payer.publicKey, isWritable: true, isSigner: true },
      ],
      data,
    });
    await send("extend-top-level", [ix]);
    const afterSnapshot = await accounts([v3.deriveProgramdataV3(program)]),
      after = pd(afterSnapshot.value[0]);
    assert(after.authority.equals(c.authority));
    assert.equal(after.capacity, a.length);
    const payload = bytes(afterSnapshot.value[0]).subarray(45);
    assert.equal(hash(payload.subarray(0, before.capacity)), oldControllerHash);
    assert(payload.subarray(before.capacity).every((x) => x === 0));
    await save("top-level-extension.json", { before, after, delta });
    console.log(json({ after, delta }));
  } else if (stage === "fund") {
    assert(/^\d+$/.test(arg));
    const lamports = Number(arg);
    assert(lamports > 0 && lamports <= 7000000000);
    await send(
      `fund-${lamports}`,
      [
        SystemProgram.transfer({
          fromPubkey: treasury,
          toPubkey: payer.publicKey,
          lamports,
        }),
      ],
      [],
      [],
      true,
    );
  } else if (stage === "create-controller") {
    assert(/^[a-f0-9]{40}$/.test(arg), "exact source commit required");
    const c = await council(),
      a = await artifact("controller"),
      b = await kp("controller-buffer.json");
    const s = await accounts([v3.deriveProgramdataV3(program)]),
      before = pd(s.value[0]);
    const expectedBefore = (await exists("top-level-extension.json"))
      ? (await load("top-level-extension.json")).after.sha256
      : oldControllerHash;
    assert.equal(before.sha256, expectedBefore);
    assert(before.authority.equals(c.authority));
    let plan;
    if (await exists("controller-plan.json"))
      plan = await load("controller-plan.json");
    else {
      plan = {
        schema: "ameba-v3-target-extension-devnet-v1",
        sourceCommit: arg,
        artifactSha256: hash(a),
        artifactBytes: a.length,
        merkleRoot: artifactMerkleRoot(a, 16384).toString("hex"),
        proposalId: c.nextId.toString(),
        before,
        buffer: b.publicKey.toBase58(),
        genesis: v3.GOVERNANCE_V3_GENESIS,
        stateRpcOrigin,
        createdAt: new Date().toISOString(),
      };
      await save("controller-plan.json", plan);
    }
    assert.equal(plan.artifactSha256, hash(a));
    assert.equal(plan.sourceCommit, arg);
    const action = {
      kind: "upgradeController",
      buffer: b.publicKey,
      artifactLength: BigInt(a.length),
      artifactSha256: Buffer.from(hash(a), "hex"),
      merkleRoot: artifactMerkleRoot(a, 16384),
      deployedSlot: BigInt(plan.before.slot),
      capacity: BigInt(plan.before.capacity),
      sourceCommitment: Buffer.from(hash(Buffer.from(arg)), "hex"),
      buildCommitment: Buffer.from(hash(Buffer.from(json(plan))), "hex"),
    };
    await send(
      "create-controller",
      [
        v3.createV3(
          { ...c, nextId: BigInt(plan.proposalId) },
          payer.publicKey,
          c.seats[0],
          action,
        ),
      ],
      [],
      [0],
    );
    const p = await proposal();
    await save("controller-proposal.json", p);
    console.log(
      json({
        proposal: v3.deriveProposalV3(program, p.id)[0],
        created: p.created,
        notBefore: p.notBefore,
        reviewEnd: p.reviewEnd,
        approvalSlots: p.reviewEnd - p.created,
      }),
    );
  } else if (stage === "create-buffer") {
    assert(["controller", "spread"].includes(arg));
    const a = await artifact(arg),
      b = await kp(`${arg}-buffer.json`),
      s = await accounts([b.publicKey]);
    assert.equal(
      s.value[0],
      null,
      "buffer already exists; inspect before continuing",
    );
    const rent = await rpc("getMinimumBalanceForRentExemption", [
      a.length + 37,
      { commitment: "finalized" },
    ]);
    const ix = new TransactionInstruction({
      programId: v3.LOADER_V3,
      keys: [
        { pubkey: b.publicKey, isWritable: true, isSigner: false },
        { pubkey: deployer.publicKey, isWritable: false, isSigner: false },
      ],
      data: Buffer.alloc(4),
    });
    await send(
      `create-${arg}-buffer`,
      [
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: b.publicKey,
          lamports: rent,
          space: a.length + 37,
          programId: v3.LOADER_V3,
        }),
        ix,
      ],
      [b],
    );
    console.log(
      json({ buffer: b.publicKey, bytes: a.length, rentLamports: rent }),
    );
  } else if (stage === "approve-controller") {
    let p = await proposal();
    const c = await council(),
      a = await artifact("controller"),
      plan = await load("controller-plan.json");
    assert.equal(hash(a), plan.artifactSha256);
    if (!(await exists("seal-controller-finalized.json"))) {
      await bufferMatches("controller");
      await send(
        "seal-controller",
        [v3.sealBufferV3(program, p, deployer.publicKey)],
        [deployer],
      );
    }
    for (let i = 0; i < Math.ceil(a.length / 16384); i += 3) {
      const instructions = [];
      for (let n = i; n < Math.min(i + 3, Math.ceil(a.length / 16384)); n++)
        instructions.push(
          v3.verifyChunkV3(program, p, n, artifactMerkleProof(a, n, 16384)),
        );
      await send(`verify-controller-${i}`, instructions);
    }
    p = await proposal();
    assert.equal(p.verifiedCount, Math.ceil(a.length / 16384));
    await send(
      "approve-controller",
      c.seats.slice(0, 3).map((s) => v3.approveV3(c, p, s)),
      [],
      [0, 1, 2],
    );
    p = await proposal();
    assert.equal(p.approvalCount, 3);
    await save("controller-approved.json", p);
    console.log(
      json({
        approvalCount: p.approvalCount,
        notBefore: p.notBefore,
        reviewEnd: p.reviewEnd,
      }),
    );
  } else if (stage === "execute-controller") {
    const c = await council();
    let p = await proposal();
    const now = BigInt(await rpc("getSlot", [{ commitment: "finalized" }]));
    assert(now >= p.notBefore, `timelock: ${p.notBefore - now} slots remain`);
    while (
      p.action.artifactLength > (p.extendedCapacity || p.action.capacity)
    ) {
      await send(
        `extend-controller-${p.extendedCapacity || p.action.capacity}`,
        [v3.extendControllerV3(c, p, payer.publicKey)],
      );
      p = await proposal();
    }
    await send("execute-controller", [v3.executeControllerUpgradeV3(c, p)]);
    const s = await accounts([v3.deriveProgramdataV3(program)]),
      live = pd(s.value[0]),
      a = await artifact("controller");
    assert.equal(live.sha256, hash(a));
    assert(live.authority.equals(c.authority));
    await save("controller-upgraded.json", live);
    console.log(json(live));
  } else if (stage === "deploy-spread") {
    await bufferMatches("spread");
    const c = await council(),
      live = pd((await accounts([v3.deriveProgramdataV3(program)])).value[0]);
    assert.equal(live.sha256, hash(await artifact("controller")));
    assert(live.authority.equals(c.authority));
    const s = await accounts([target]);
    assert.equal(s.value[0], null, "fresh target already exists");
    const a = await artifact("spread");
    const args = [
      "--url",
      stateRpcUrl,
      "--commitment",
      "finalized",
      "--keypair",
      run + "/fee-payer.json",
      "program",
      "deploy",
      "--program-id",
      run + "/spread-program.json",
      "--upgrade-authority",
      run + "/spread-deployer.json",
      "--buffer",
      run + "/spread-buffer.json",
      "--fee-payer",
      run + "/fee-payer.json",
      "--max-len",
      String(a.length),
      "--no-auto-extend",
      "--use-rpc",
      "--max-sign-attempts",
      "3",
      "--with-compute-unit-price",
      "1000",
      "--output",
      "json",
    ];
    const chunks = [];
    const code = await new Promise((resolve, reject) => {
      const child = spawn("solana", args, { shell: false });
      const collect = (b) => {
        chunks.push(b);
        if (/\b429\b|Too Many Requests/.test(b.toString()))
          child.kill("SIGTERM");
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      child.on("error", reject);
      child.on("close", resolve);
    });
    const output = Buffer.concat(chunks)
      .toString()
      .split(stateRpcUrl)
      .join("[state RPC]");
    await save("spread-deploy-result.json", {
      code,
      output,
      artifactSha256: hash(a),
      artifactBytes: a.length,
    });
    console.log(output);
    assert.equal(code, 0);
  } else if (stage === "register-spread") {
    const c = await council(),
      s = await accounts([
        v3.deriveProgramdataV3(program),
        v3.deriveProgramdataV3(target),
      ]),
      controller = pd(s.value[0]),
      spread = pd(s.value[1]);
    assert.equal(controller.sha256, hash(await artifact("controller")));
    assert.equal(spread.sha256, hash(await artifact("spread")));
    assert(spread.authority.equals(deployer.publicKey));
    await send(
      "register-spread",
      [
        v3.registerTargetV3(
          c,
          target,
          deployer.publicKey,
          payer.publicKey,
          c.seats.slice(0, 3),
        ),
      ],
      [deployer],
      [0, 1, 2],
    );
  } else throw Error("unknown stage");
} catch (error) {
  await journal({
    stage,
    failed: true,
    error: error.message,
    automaticRetry: false,
  });
  throw error;
} finally {
  await lock.close();
  await unlink(lockFile);
}
