import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tool = path.join(root, "tools", "devnet-governance-v2-former-authority-proof-close.mjs");

test("former-authority boundary self-test pins exact Loader envelopes", () => {
  const result = spawnSync(process.execPath, [tool, "self-test"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env },
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.schema, "ameba-governance-devnet-v2-former-authority-boundary-self-test-v1");
  assert.deepEqual(value.tags, { loaderUpgrade: "03000000", loaderClose: "05000000" });
  assert.deepEqual(value.accountCounts, { loaderUpgrade: 7, loaderClose: 3 });
  assert.deepEqual(value.packetBytes, { loaderUpgrade: 470, loaderClose: 338 });
  assert.equal(value.minimalProofBufferBytes, 38);
  assert.equal(value.exactlyOneDirectNegativeSubmissionSite, true);
  assert.equal(value.injectedSignerOnly, true);
  assert.equal(value.runtime.firstRateLimitCallCount, 1);
  assert.equal(value.runtime.ambiguousPreparedTransactionSendCalls, 0);
});

test("former-authority boundary has one negative send site and a typed close", () => {
  const source = readFileSync(tool, "utf8");
  for (const command of ["verify-evidence-offline", "status", "plan-next", "execute-next"]) {
    assert(source.includes(`"${command}"`), `missing command ${command}`);
  }
  assert.equal((source.match(/sendRawTransaction\(/gu) ?? []).length, 1);
  assert(source.includes("skipPreflight: true"));
  assert(source.includes("maxRetries: 0"));
  assert(source.includes("submitOneFinalized"));
  assert(source.includes("reconcileOneFinalized"));
  assert(source.includes("AMEBA_GOVERNANCE_V2_SIGNER_PROVIDER"));
  assert(source.includes("spread-former-authority-minimal-proof-buffer-receipt-v2.json"));
  assert(source.includes("IncorrectAuthority"));
  assert(!source.includes(["loadSecure", "Keypair"].join("")));
  assert(!source.includes("AUTHORITY_PRIVATE_KEY"));
  assert(!source.includes("RAW_SIGNATURE"));
});

test("former-authority boundary refuses missing evidence before RPC", () => {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (name.startsWith("AMEBA_")) delete environment[name];
  }
  const result = spawnSync(process.execPath, [tool, "status"], {
    cwd: root,
    encoding: "utf8",
    env: environment,
    timeout: 30_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /AMEBA_GOVERNANCE_V2_BASE_DESCRIPTOR is required/u);
  assert.doesNotMatch(result.stderr, /getGenesisHash|sendRawTransaction/u);
});
