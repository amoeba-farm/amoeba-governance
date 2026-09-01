import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const provider = path.join(root, "tools", "devnet-governance-v2-kms-signer-provider.mjs");

test("governance V2 signer-provider self-test pins the local payer and KMS authority surface", () => {
  const result = spawnSync(process.execPath, [provider, "self-test"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env },
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.schema, "ameba-governance-v2-kms-signer-provider-self-test-v1");
  assert.equal(value.payer, "G2f6Fv477ZyFbmRFtVr21jf9VufXpiRCxf1e91J6SxxT");
  assert.deepEqual(value.kmsAuthorities.map(({ role }: { role: string }) => role), [
    "legacy-target-authority", "seat-0", "seat-1", "seat-2", "seat-3", "seat-4",
  ]);
  assert.equal(value.localPrivateAuthorityAllowed, false);
  assert.equal(value.rawSignatureInputAllowed, false);
  assert.equal(value.rpcUsed, false);
  assert.equal(value.signingUsed, false);
});

test("governance V2 signer-provider exposes no raw authority-key or raw-signature input", () => {
  const source = readFileSync(provider, "utf8");
  assert(source.includes("AMEBA_GOVERNANCE_V2_FEE_PAYER_KEYPAIR"));
  assert(source.includes("AMEBA_GOVERNANCE_V2_KMS_SIGNER_TOOL"));
  for (const environment of [
    "AMEBA_LEGACY_AUTHORITY_KMS_PUBLIC_PEM",
    "AMEBA_SEAT_0_KMS_PUBLIC_PEM",
    "AMEBA_SEAT_1_KMS_PUBLIC_PEM",
    "AMEBA_SEAT_2_KMS_PUBLIC_PEM",
    "AMEBA_SEAT_3_KMS_PUBLIC_PEM",
    "AMEBA_SEAT_4_KMS_PUBLIC_PEM",
  ]) assert(source.includes(environment), `missing ${environment}`);
  assert(source.includes("gcp-kms-ed25519-signature-v1"));
  assert(source.includes("single-use"));
  assert(!source.includes("AUTHORITY_PRIVATE_KEY"));
  assert(!source.includes("RAW_SIGNATURE"));
  assert(!source.includes("sendRawTransaction"));
  assert(!source.includes("Connection("));
});
