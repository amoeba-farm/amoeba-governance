#!/usr/bin/env node

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  runUpgradeGovernanceCliV1,
  stringifyUpgradeGovernanceCliResultV1,
  type UpgradeGovernanceCliAdaptersV1,
} from "./cli.js";

export const UPGRADE_GOVERNANCE_EXECUTABLE_USAGE_V1 = `Usage:
  amoeba-upgrade-governance --adapter-module <local .js/.mjs file> <command> [--payload-json <json>] [--arm <operation-id>]

The executable contains no wallet, keypair, RPC, or submission fallback. The
explicit local adapter module must inject finalized reads, planning, signing,
journaling, locking, and submission capabilities.

verify-handoff requires payload.clusterDomainHex plus payload.receipt. The
built-in verifier computes the verdict after independently re-querying the
finalized source supplied by the adapter; adapter-provided verdicts are not
accepted.

verify-local-ceremony requires the same explicit cluster-domain binding and a
receipt-v4 value. The checked-in local adapter is read-only and accepts only an
explicit loopback validator endpoint plus narrow journal and lock file paths.
`;

export interface UpgradeGovernanceExecutableAdapterModuleV1 {
  createUpgradeGovernanceCliAdaptersV1():
    | UpgradeGovernanceCliAdaptersV1
    | Promise<UpgradeGovernanceCliAdaptersV1>;
}

export type UpgradeGovernanceExecutableModuleLoaderV1 = (
  absoluteModulePath: string,
) => Promise<Partial<UpgradeGovernanceExecutableAdapterModuleV1>>;

export interface UpgradeGovernanceExecutableIoV1 {
  stdout(value: string): void;
  stderr(value: string): void;
}

function parseExecutableArguments(argv: readonly string[]): {
  adapterModulePath: string;
  cliArguments: readonly string[];
} | { help: true } {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) return { help: true };
  let adapterModulePath: string | undefined;
  const cliArguments: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--adapter-module" || argument.startsWith("--adapter-module=")) {
      if (adapterModulePath !== undefined) throw new Error("--adapter-module may appear only once");
      const inline = argument.startsWith("--adapter-module=")
        ? argument.slice("--adapter-module=".length)
        : undefined;
      const value = inline ?? argv[++index];
      if (value === undefined || value.length === 0 || value.startsWith("--")) {
        throw new Error("--adapter-module requires a local file path");
      }
      const windowsAbsolutePath = /^[a-z]:[\\/]/iu.test(value);
      if ((!windowsAbsolutePath && /^[a-z][a-z0-9+.-]*:/iu.test(value)) || value.includes("\0")) {
        throw new Error("--adapter-module accepts only a local file path");
      }
      if (!/\.(?:mjs|js)$/iu.test(value)) {
        throw new Error("--adapter-module must name a .js or .mjs file");
      }
      adapterModulePath = resolve(value);
    } else {
      cliArguments.push(argument);
    }
  }
  if (adapterModulePath === undefined) throw new Error("--adapter-module is required");
  if (cliArguments.length === 0) throw new Error("an upgrade-governance command is required");
  return { adapterModulePath, cliArguments };
}

/** Executable wrapper over the same fail-closed dispatcher used by consumers.
 * The loader is injectable for tests; production invocation imports only the
 * one explicit local adapter path supplied by the operator. */
export async function runUpgradeGovernanceExecutableV1(
  argv: readonly string[],
  io: UpgradeGovernanceExecutableIoV1,
  loadModule: UpgradeGovernanceExecutableModuleLoaderV1 = async (absolutePath) => (
    await import(pathToFileURL(absolutePath).href) as Partial<UpgradeGovernanceExecutableAdapterModuleV1>
  ),
): Promise<number> {
  const parsed = parseExecutableArguments(argv);
  if ("help" in parsed) {
    io.stdout(UPGRADE_GOVERNANCE_EXECUTABLE_USAGE_V1);
    return 0;
  }
  const module = await loadModule(parsed.adapterModulePath);
  if (typeof module.createUpgradeGovernanceCliAdaptersV1 !== "function") {
    throw new Error("adapter module must export createUpgradeGovernanceCliAdaptersV1()");
  }
  const adapters = await module.createUpgradeGovernanceCliAdaptersV1();
  const result = await runUpgradeGovernanceCliV1(parsed.cliArguments, adapters);
  io.stdout(stringifyUpgradeGovernanceCliResultV1(result));
  return 0;
}

async function main(): Promise<void> {
  try {
    const code = await runUpgradeGovernanceExecutableV1(process.argv.slice(2), {
      stdout(value) { process.stdout.write(value); },
      stderr(value) { process.stderr.write(value); },
    });
    process.exitCode = code;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "upgrade-governance executable failed"}\n`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  void main();
}
