// Fresh Devnet council core only. No existing target or governance accounts are written.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  chmod,
  open,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PublicKey,
  Keypair,
  Transaction,
  VersionedTransaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  GOVERNANCE_V3_GENESIS,
  LOADER_V3,
  initializeV3,
  decodeConfigV3,
  deriveConfigV3,
  deriveProgramdataV3,
  deriveAuthorityV3,
} from "../dist/upgradeGovernance/governanceV3.js";
import {
  loadDevnetRpcConfiguration,
  requireSecureRegularFile,
  requireSecureDirectory,
} from "./secure-rpc-env.mjs";

process.umask(0o077);
const [mode, runInput, artifactInput, sourceRunInput] = process.argv.slice(2);
assert(
  ["prepare", "deploy", "initialize", "status"].includes(mode),
  "mode: prepare|deploy|initialize|status",
);
assert(
  runInput && path.isAbsolute(runInput),
  "absolute run directory required",
);
const run = path.resolve(runInput);
if (mode === "prepare") await mkdir(run, { mode: 0o700 });
await requireSecureDirectory(run, "V3 run");
const json = (x) =>
  JSON.stringify(x, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) +
  "\n";
const hash = (x) => createHash("sha256").update(x).digest("hex");
const save = (name, value) =>
  writeFile(path.join(run, name), json(value), { mode: 0o600 });
const load = async (name) =>
  JSON.parse(await readFile(path.join(run, name), "utf8"));
const keypair = async (name) =>
  Keypair.fromSecretKey(Uint8Array.from(await load(name)));
const keys = [
  "pSutXCyMTkwvzG1kpiHXULkVKyzz8NPSNgnjLgwNcTu",
  "4vrxWeSfCoJA8KvzCcWGgG4C5S4gPYrLaRWysycJeVpz",
  "DgMGtSjUg1wXPZuPBT6HqGN3qRLVBJCqYrv31XtcwcBR",
  "4SJyALW3CinnBrFUzHeJL6v5KM12hw2FGLL1wbVTVfn8",
  "Cmd42MrYC7CVyQNGq7GRkTqR3jQ8cBPKzjzDpsc5eNW4",
];
const seats = keys.map((x) => new PublicKey(x));
const treasury = new PublicKey("8XUjnzVzR71DaVuqbSHaNev5H4vrxofyFP4iZt2FXa1j");
const feePayerAddress = "G2f6Fv477ZyFbmRFtVr21jf9VufXpiRCxf1e91J6SxxT";
const { stateRpcUrl, stateRpcOrigin } = await loadDevnetRpcConfiguration();
async function rpc(method, params = []) {
  const response = await fetch(stateRpcUrl, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) {
    await save("rpc-failure.json", {
      status: response.status,
      retryAfter: response.headers.get("retry-after"),
      automaticRetry: false,
    });
    throw Error(`RPC HTTP ${response.status}; stopped`);
  }
  const result = await response.json();
  assert(!result.error, JSON.stringify(result.error));
  return result.result;
}
const lock = path.join(run, "release1-devnet-rpc-owner.lock");
const lockHandle = await open(lock, "wx", 0o600);
try {
  await lockHandle.writeFile(
    json({ pid: process.pid, mode, started: new Date().toISOString() }),
  );
  assert.equal(
    await rpc("getGenesisHash"),
    GOVERNANCE_V3_GENESIS,
    "not Devnet",
  );
  if (mode === "prepare") {
    assert(
      artifactInput && sourceRunInput,
      "prepare requires artifact and existing Devnet signer directory",
    );
    const source = await requireSecureDirectory(
      sourceRunInput,
      "existing Devnet signer directory",
    );
    const payerFile = await requireSecureRegularFile(
      path.join(source, "fee-payer.json"),
      "existing Devnet payer",
    );
    await copyFile(payerFile, path.join(run, "fee-payer.json"));
    await chmod(path.join(run, "fee-payer.json"), 0o600);
    assert.equal(
      (await keypair("fee-payer.json")).publicKey.toBase58(),
      feePayerAddress,
    );
    for (let i = 0; i < 3; i++) {
      await copyFile(
        await requireSecureRegularFile(
          path.join(source, `seat-${i}.pem`),
          "KMS public key",
        ),
        path.join(run, `seat-${i}.pem`),
      );
      await chmod(path.join(run, `seat-${i}.pem`), 0o600);
    }
    for (const name of ["program", "deployer", "deploy-buffer"])
      await save(
        `${name}.keypair.json`,
        Array.from(Keypair.generate().secretKey),
      );
    const artifact = await readFile(artifactInput);
    assert(
      artifact.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])),
      "not ELF",
    );
    await writeFile(path.join(run, "governance_controller_v3.so"), artifact, {
      mode: 0o600,
    });
    const program = (await keypair("program.keypair.json")).publicKey;
    const absent = await rpc("getMultipleAccounts", [
      [
        program.toBase58(),
        deriveProgramdataV3(program).toBase58(),
        deriveConfigV3(program)[0].toBase58(),
      ],
      { commitment: "finalized", encoding: "base64" },
    ]);
    assert(
      absent.value.every((x) => x === null),
      "fresh addresses must be absent",
    );
    const rent = await rpc("getMinimumBalanceForRentExemption", [
      artifact.length + 45,
      { commitment: "finalized" },
    ]);
    const balance = await rpc("getBalance", [
      feePayerAddress,
      { commitment: "finalized" },
    ]);
    assert(
      balance.value > rent * 2 + 30_000_000,
      "insufficient Devnet deployment funds",
    );
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../..",
    );
    const commit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    assert.equal(
      execFileSync("git", ["status", "--porcelain"], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
      "",
      "source worktree must be clean",
    );
    const plan = {
      schema: "ameba-governance-v3-core-devnet-v1",
      createdAt: new Date().toISOString(),
      genesis: GOVERNANCE_V3_GENESIS,
      sourceCommit: commit,
      sourceRoot: root,
      artifactSha256: hash(artifact),
      artifactBytes: artifact.length,
      stateProviderOriginSha256: hash(stateRpcOrigin),
      program: program.toBase58(),
      programdata: deriveProgramdataV3(program).toBase58(),
      config: deriveConfigV3(program)[0].toBase58(),
      authority: deriveAuthorityV3(program)[0].toBase58(),
      deployer: (await keypair("deployer.keypair.json")).publicKey.toBase58(),
      feePayer: feePayerAddress,
      seats: keys,
      treasury: treasury.toBase58(),
      threshold: 3,
      reviewSlots: 1512000,
      delaySlots: 4500,
      expirySlots: 2592000,
      preflightBalanceLamports: balance.value,
      estimatedProgramRentLamports: rent,
      spreadIntegration: false,
    };
    await save("plan.json", plan);
    process.stdout.write(json(plan));
  } else {
    const plan = await load("plan.json");
    const artifact = await readFile(
      path.join(run, "governance_controller_v3.so"),
    );
    assert.equal(plan.genesis, GOVERNANCE_V3_GENESIS);
    assert.equal(plan.artifactSha256, hash(artifact));
    assert.equal(plan.artifactBytes, artifact.length);
    assert.deepEqual(plan.seats, keys);
    assert.equal(plan.treasury, treasury.toBase58());
    const program = new PublicKey(plan.program);
    assert.equal(plan.programdata, deriveProgramdataV3(program).toBase58());
    const snapshot = async () =>
      rpc("getMultipleAccounts", [
        [plan.program, plan.programdata, plan.config],
        { commitment: "finalized", encoding: "base64" },
      ]);
    const verifyProgram = (value, authority) => {
      const [programAccount, dataAccount] = value;
      assert(programAccount && dataAccount, "program absent");
      assert.equal(programAccount.owner, LOADER_V3.toBase58());
      assert(programAccount.executable);
      assert.equal(dataAccount.owner, LOADER_V3.toBase58());
      assert.equal(dataAccount.executable, false);
      const p = Buffer.from(programAccount.data[0], "base64"),
        d = Buffer.from(dataAccount.data[0], "base64");
      assert.equal(p.length, 36);
      assert.equal(p.readUInt32LE(), 2);
      assert(new PublicKey(p.subarray(4)).equals(deriveProgramdataV3(program)));
      assert.equal(d.length, 45 + artifact.length);
      assert.equal(d.readUInt32LE(), 3);
      assert.equal(d[12], 1);
      assert.equal(new PublicKey(d.subarray(13, 45)).toBase58(), authority);
      assert.equal(hash(d.subarray(45)), plan.artifactSha256);
      return d.readBigUInt64LE(4);
    };
    if (mode === "deploy") {
      assert.equal(
        (await keypair("program.keypair.json")).publicKey.toBase58(),
        plan.program,
      );
      assert.equal(
        (await keypair("deployer.keypair.json")).publicKey.toBase58(),
        plan.deployer,
      );
      assert.equal(
        (await keypair("fee-payer.json")).publicKey.toBase58(),
        plan.feePayer,
      );
      const before = await snapshot();
      assert(
        before.value.every((x) => x === null),
        "deployment only accepts fresh accounts",
      );
      await save("deploy-start.json", {
        ...plan,
        started: new Date().toISOString(),
      });
      const args = [
        "--url",
        stateRpcUrl,
        "--commitment",
        "finalized",
        "--keypair",
        path.join(run, "fee-payer.json"),
        "program",
        "deploy",
        path.join(run, "governance_controller_v3.so"),
        "--program-id",
        path.join(run, "program.keypair.json"),
        "--upgrade-authority",
        path.join(run, "deployer.keypair.json"),
        "--buffer",
        path.join(run, "deploy-buffer.keypair.json"),
        "--fee-payer",
        path.join(run, "fee-payer.json"),
        "--max-len",
        String(plan.artifactBytes),
        "--no-auto-extend",
        "--use-rpc",
        "--max-sign-attempts",
        "1",
        "--with-compute-unit-price",
        "1000",
        "--output",
        "json",
      ];
      const chunks = [];
      let rateLimited = false;
      const code = await new Promise((resolve, reject) => {
        const child = spawn("solana", args, {
          shell: false,
          windowsHide: true,
        });
        const collect = (x) => {
          chunks.push(x);
          if (/\b429\b|Too Many Requests/.test(x.toString())) {
            rateLimited = true;
            child.kill("SIGTERM");
          }
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
      await writeFile(path.join(run, "deploy.log"), output, { mode: 0o600 });
      if (rateLimited)
        await save("rpc-failure.json", {
          status: 429,
          automaticRetry: false,
          retryAfter: "see private deploy.log",
        });
      assert.equal(code, 0, "deployment failed; inspect private deploy.log");
      const after = await snapshot();
      const deployedSlot = verifyProgram(after.value, plan.deployer);
      const receipt = {
        program: plan.program,
        deployedSlot,
        finalizedSlot: after.context.slot,
        artifactSha256: plan.artifactSha256,
        authority: plan.deployer,
      };
      await save("deploy-receipt.json", receipt);
      process.stdout.write(json(receipt));
    } else if (mode === "initialize") {
      const before = await snapshot();
      verifyProgram(before.value, plan.deployer);
      assert.equal(before.value[2], null, "config already exists");
      const payer = await keypair("fee-payer.json"),
        deployer = await keypair("deployer.keypair.json");
      const latest = (
        await rpc("getLatestBlockhash", [{ commitment: "finalized" }])
      ).value;
      const tx = new Transaction({ feePayer: payer.publicKey, ...latest }).add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }),
        initializeV3(
          program,
          payer.publicKey,
          deployer.publicKey,
          seats,
          treasury,
          seats.slice(0, 3),
        ),
      );
      tx.partialSign(payer, deployer);
      const message = tx.serializeMessage();
      const messageHash = hash(message);
      const messageFile = path.join(run, "initialize-message.bin");
      await writeFile(messageFile, message, { mode: 0o600 });
      await save("initialize-plan.json", {
        program: plan.program,
        config: plan.config,
        authority: plan.authority,
        seats: keys,
        treasury: plan.treasury,
        messageSha256: messageHash,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      });
      const token = execFileSync(
        "python3",
        [
          process.env.AMEBA_GCLOUD_PYTHON_ENTRY,
          "auth",
          "print-access-token",
          "--quiet",
        ],
        {
          encoding: "utf8",
          env: { ...process.env, CLOUDSDK_CORE_DISABLE_PROMPTS: "1" },
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 45000,
        },
      ).trim();
      assert(token.length > 30 && !/\s/.test(token), "invalid GCP token");
      for (let i = 0; i < 3; i++) {
        const resource = `projects/amoeba-hm0q2k/locations/global/keyRings/ameba-spread-devnet/cryptoKeys/governance-seat-${i + 1}-v1/cryptoKeyVersions/1`;
        const result = execFileSync(
          process.execPath,
          [
            path.join(
              path.dirname(fileURLToPath(import.meta.url)),
              "gcp-kms-ed25519-signer.mjs",
            ),
            "--authority",
            keys[i],
            "--kms-key-version",
            resource,
            "--public-key-pem",
            path.join(run, `seat-${i}.pem`),
            "--message",
            messageFile,
            "--expected-message-sha256",
            messageHash,
          ],
          {
            encoding: "utf8",
            env: { ...process.env, AMEBA_GCP_KMS_ACCESS_TOKEN: token },
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 30000,
          },
        );
        const signed = JSON.parse(result);
        assert.equal(signed.authority, keys[i]);
        assert.equal(signed.messageSha256, messageHash);
        tx.addSignature(
          seats[i],
          Buffer.from(signed.signatureBase64, "base64"),
        );
      }
      assert(tx.serializeMessage().equals(message));
      assert(tx.verifySignatures());
      const wire = tx.serialize();
      assert(wire.length <= 1232);
      VersionedTransaction.deserialize(wire);
      const simulation = await rpc("simulateTransaction", [
        wire.toString("base64"),
        { encoding: "base64", commitment: "finalized", sigVerify: true },
      ]);
      await save("initialize-simulation.json", simulation);
      assert.equal(simulation.value.err, null, "bootstrap simulation failed");
      await writeFile(path.join(run, "initialize-transaction.bin"), wire, {
        mode: 0o600,
      });
      const signature = await rpc("sendTransaction", [
        wire.toString("base64"),
        {
          encoding: "base64",
          preflightCommitment: "finalized",
          skipPreflight: false,
          maxRetries: 0,
        },
      ]);
      await save("initialize-submitted.json", {
        signature,
        messageSha256: messageHash,
      });
      process.stdout.write(json({ signature, submitted: true }));
    } else {
      const after = await snapshot();
      const authority = after.value[2] ? plan.authority : plan.deployer;
      const deployedSlot = verifyProgram(after.value, authority);
      let config = null;
      if (after.value[2]) {
        assert.equal(after.value[2].owner, plan.program);
        assert.equal(after.value[2].executable, false);
        config = decodeConfigV3(
          program,
          new PublicKey(plan.config),
          Buffer.from(after.value[2].data[0], "base64"),
        );
        assert.deepEqual(
          config.seats.map((x) => x.toBase58()),
          keys,
        );
        assert.equal(config.treasury.toBase58(), plan.treasury);
        assert.equal(config.timing.reviewSlots, 1512000n);
        assert.equal(config.timing.delaySlots, 4500n);
        assert.equal(config.timing.expirySlots, 2592000n);
      }
      const receipt = {
        ...plan,
        verifiedAt: new Date().toISOString(),
        finalizedSlot: after.context.slot,
        deployedSlot,
        liveAuthority: authority,
        initialized: config !== null,
        configState: config,
      };
      await save("verified-receipt.json", receipt);
      process.stdout.write(json(receipt));
    }
  }
} finally {
  await lockHandle.close();
  await unlink(lock);
}
