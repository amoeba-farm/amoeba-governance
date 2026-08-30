import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

const ALLOWED_KEYS = new Set([
  "AMEBA_DEVNET_STATE_RPC_URL",
  "AMEBA_DEVNET_HISTORY_RPC_URL",
  "AMEBA_DEVNET_HELIUS_STATE_RPC_URL",
]);

const RPC_SELECTION_KEYS = new Map([
  ["state", "AMEBA_DEVNET_STATE_RPC_URL"],
  ["history", "AMEBA_DEVNET_HISTORY_RPC_URL"],
  ["helius-state", "AMEBA_DEVNET_HELIUS_STATE_RPC_URL"],
]);

export async function requireSecureRegularFile(file, label) {
  const resolved = path.resolve(file);
  const status = await lstat(resolved);
  assert(status.isFile() && !status.isSymbolicLink(), `${label} must be a regular non-symlink file`);
  if (typeof process.getuid === "function") {
    assert.equal(status.uid, process.getuid(), `${label} must be owned by the current user`);
  }
  assert.equal(status.mode & 0o077, 0, `${label} must not grant group or other permissions`);
  return resolved;
}

export async function requireSecureDirectory(directory, label) {
  const resolved = path.resolve(directory);
  const status = await lstat(resolved);
  assert(status.isDirectory() && !status.isSymbolicLink(), `${label} must be a directory, not a symlink`);
  if (typeof process.getuid === "function") {
    assert.equal(status.uid, process.getuid(), `${label} must be owned by the current user`);
  }
  assert.equal(status.mode & 0o077, 0, `${label} must not grant group or other permissions`);
  return resolved;
}

function parseValue(raw, lineNumber) {
  const value = raw.trim();
  if (value.startsWith("'") && value.endsWith("'")) {
    const body = value.slice(1, -1);
    assert(!body.includes("'"), `RPC environment line ${lineNumber} has unsupported quoting`);
    return body;
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    const body = value.slice(1, -1);
    assert(!/["\\$`]/u.test(body), `RPC environment line ${lineNumber} has unsupported expansion syntax`);
    return body;
  }
  assert(/^[A-Za-z0-9:/?&=._%+~-]+$/u.test(value), `RPC environment line ${lineNumber} is not a literal value`);
  return value;
}

export async function loadDevnetRpcConfiguration() {
  const input = process.env.AMEBA_RPC_ENV_FILE?.trim();
  assert(input, "AMEBA_RPC_ENV_FILE is required");
  const file = await requireSecureRegularFile(input, "RPC environment file");
  const text = await readFile(file, "utf8");
  const values = new Map();
  for (const [index, original] of text.split(/\r?\n/u).entries()) {
    const line = original.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)$/u.exec(line);
    assert(match, `RPC environment line ${index + 1} is not a literal assignment`);
    const [, key, raw] = match;
    assert(ALLOWED_KEYS.has(key), `RPC environment key ${key} is not allowed`);
    assert(!values.has(key), `RPC environment key ${key} is duplicated`);
    values.set(key, parseValue(raw, index + 1));
  }
  const selection = process.env.AMEBA_RPC_SELECTION?.trim() || "state";
  const selectedKey = RPC_SELECTION_KEYS.get(selection);
  assert(selectedKey, `unsupported Devnet RPC selection ${selection}`);
  const stateRpcUrl = values.get(selectedKey);
  assert(stateRpcUrl, `${selectedKey} is absent`);
  const parsed = new URL(stateRpcUrl);
  assert.equal(parsed.protocol, "https:", "state RPC must use HTTPS");
  assert.equal(parsed.username, "", "state RPC URL must not contain username credentials");
  assert.equal(parsed.password, "", "state RPC URL must not contain password credentials");
  assert.equal(parsed.hash, "", "state RPC URL must not contain a fragment");
  return { rpcSelection: selection, stateRpcUrl, stateRpcOrigin: parsed.origin };
}
