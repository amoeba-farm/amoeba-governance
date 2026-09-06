import assert from "node:assert/strict";
import { readFile, appendFile, open, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
const root =
  "/mnt/c/Users/space/.codex/worktrees/governance-v3-week-window/ameba_gov/clients/ts";
const require = createRequire(root + "/package.json");
const {
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
} = require("@solana/web3.js");
const bs58 = require("bs58");
const { loadDevnetRpcConfiguration } = await import(
  root + "/tools/secure-rpc-env.mjs"
);
const { stateRpcUrl } = await loadDevnetRpcConfiguration();
const run = "/home/space/.local/state/ameba/spread-v3-devnet-20260905";
const which = process.argv[2];
assert(["controller", "spread"].includes(which));
const plan = JSON.parse(
  await readFile(run + "/" + which + "-plan.json", "utf8"),
);
const artifact = await readFile(
  run +
    "/" +
    which +
    "-deploy/" +
    (which === "controller"
      ? "governance_controller_v3.so"
      : "light_token_minter.so"),
);
assert.equal(
  createHash("sha256").update(artifact).digest("hex"),
  plan.artifactSha256,
);
const kp = async (file) =>
  Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(await readFile(`${run}/${file}`, "utf8"))),
  );
const payer = await kp("fee-payer.json"),
  deployer = await kp("spread-deployer.json"),
  buffer = await kp(which + "-buffer.json");
assert.equal(
  payer.publicKey.toBase58(),
  "G2f6Fv477ZyFbmRFtVr21jf9VufXpiRCxf1e91J6SxxT",
);
assert.equal(
  deployer.publicKey.toBase58(),
  "GFcbEfGvi1j12rEm2eAC4e3TGUaQDJjSVDX9nqGVRf6Q",
);
const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
async function rpc(method, params = []) {
  const response = await fetch(stateRpcUrl, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(25000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) {
    await appendFile(
      run + "/rpc-backoff.jsonl",
      JSON.stringify({
        status: response.status,
        retryAfter: response.headers.get("retry-after"),
        backoffSeconds: 60,
        automaticRetry: false,
        at: new Date().toISOString(),
      }) + "\n",
      { mode: 0o600 },
    );
    throw Error(`HTTP ${response.status}; no retry`);
  }
  const v = await response.json();
  assert(!v.error, JSON.stringify(v.error));
  return v.result;
}
const lock = await open(run + "/release1-devnet-rpc-owner.lock", "wx", 0o600);
const journal = (entry) =>
  appendFile(
    run + "/" + which + "-upload.jsonl",
    JSON.stringify({ ...entry, at: new Date().toISOString() }) + "\n",
    { mode: 0o600 },
  );
try {
  await lock.writeFile(
    JSON.stringify({ pid: process.pid, stage: which + "-buffer-upload" }),
  );
  assert.equal(await rpc("getGenesisHash"), plan.genesis);
  const observed = await rpc("getMultipleAccounts", [
    [
      buffer.publicKey.toBase58(),
      "2jVQSPny9eFoaG1ZWoJVAezQ5VgqJtF8rQCQXMktuBVw",
    ],
    { encoding: "base64", commitment: "finalized" },
  ]);
  assert.equal(observed.value[1], null, "fresh program already exists");
  const account = observed.value[0];
  assert.equal(account.owner, loader.toBase58());
  assert.equal(account.executable, false);
  const bytes = Buffer.from(account.data[0], "base64");
  assert.equal(bytes.length, artifact.length + 37);
  assert.equal(bytes.readUInt32LE(), 1);
  assert.equal(bytes[4], 1);
  assert(new PublicKey(bytes.subarray(5, 37)).equals(deployer.publicKey));
  let latest,
    submitted = 0,
    skipped = 0;
  for (let offset = 0; offset < artifact.length; offset += 800) {
    const chunk = artifact.subarray(
      offset,
      Math.min(offset + 800, artifact.length),
    );
    if (bytes.subarray(37 + offset, 37 + offset + chunk.length).equals(chunk)) {
      skipped++;
      continue;
    }
    await delay(1200);
    if (submitted % 4 === 0)
      latest = (await rpc("getLatestBlockhash", [{ commitment: "finalized" }]))
        .value;
    const data = Buffer.alloc(16 + chunk.length);
    data.writeUInt32LE(1);
    data.writeUInt32LE(offset, 4);
    data.writeBigUInt64LE(BigInt(chunk.length), 8);
    chunk.copy(data, 16);
    const tx = new Transaction({ feePayer: payer.publicKey, ...latest }).add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 50000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
      new TransactionInstruction({
        programId: loader,
        keys: [
          { pubkey: buffer.publicKey, isSigner: false, isWritable: true },
          { pubkey: deployer.publicKey, isSigner: true, isWritable: false },
        ],
        data,
      }),
    );
    tx.sign(payer, deployer);
    const wire = tx.serialize();
    assert(wire.length <= 1232);
    const signature = bs58.encode(tx.signature);
    if (submitted === 0) {
      const sim = await rpc("simulateTransaction", [
        wire.toString("base64"),
        { encoding: "base64", commitment: "finalized", sigVerify: true },
      ]);
      console.log(JSON.stringify({ firstWriteSimulation: sim.value }));
      assert.equal(sim.value.err, null);
    }
    await journal({
      stage: "signed",
      offset,
      signature,
      lastValidBlockHeight: latest.lastValidBlockHeight,
      wire: wire.toString("base64"),
    });
    const actual = await rpc("sendTransaction", [
      wire.toString("base64"),
      {
        encoding: "base64",
        skipPreflight: false,
        preflightCommitment: "finalized",
        maxRetries: 3,
      },
    ]);
    assert.equal(actual, signature);
    await journal({ stage: "submitted", offset, signature });
    submitted++;
    if (submitted % 12 === 0)
      console.log(
        JSON.stringify({
          submitted,
          skipped,
          processedBytes: offset + chunk.length,
          totalBytes: artifact.length,
        }),
      );
  }
  console.log(
    JSON.stringify({ submitted, skipped, awaitingFinalizedRead: true }),
  );
} catch (error) {
  await journal({
    stage: "failed",
    message: error.message,
    automaticRetry: false,
  });
  throw error;
} finally {
  await lock.close();
  await unlink(run + "/release1-devnet-rpc-owner.lock");
}
