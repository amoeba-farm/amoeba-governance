import assert from "node:assert/strict";
import { createPublicKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { PublicKey } from "@solana/web3.js";

if (process.argv.length < 3) {
  throw new Error("usage: node kms-public-key-address.mjs <public-key.pem> [...]");
}

const identities = [];
for (const pemPath of process.argv.slice(2)) {
  const pem = await readFile(pemPath, "utf8");
  const der = createPublicKey(pem).export({ type: "spki", format: "der" });
  assert(der.length >= 32, `${pemPath}: malformed public key`);
  const publicKey = new PublicKey(der.subarray(der.length - 32));
  identities.push({
    file: path.basename(pemPath),
    publicKey: publicKey.toBase58(),
  });
}

process.stdout.write(`${JSON.stringify(identities, null, 2)}\n`);
