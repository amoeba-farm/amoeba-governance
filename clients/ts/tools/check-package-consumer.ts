import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";

const temporaryRoot = resolve(tmpdir());
const workspace = mkdtempSync(join(temporaryRoot, "amoeba-upgrade-governance-consumer-"));
const resolvedWorkspace = resolve(workspace);
if (!resolvedWorkspace.startsWith(`${temporaryRoot}${sep}`)) {
  throw new Error("temporary package-consumer workspace escaped the OS temp directory");
}

try {
  const npmCli = process.env.npm_execpath;
  if (typeof npmCli !== "string" || npmCli.length === 0) {
    throw new Error("npm_execpath is required for the package-consumer check");
  }
  const npm = (arguments_: readonly string[], options: Parameters<typeof execFileSync>[2]) =>
    execFileSync(process.execPath, [npmCli, ...arguments_], options);
  const packResult = JSON.parse(
    npm(["pack", "--json", "--pack-destination", workspace], {
      cwd: resolve(import.meta.dirname, ".."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }),
  ) as readonly { filename: string }[];
  if (packResult.length !== 1 || typeof packResult[0]?.filename !== "string") {
    throw new Error("npm pack did not produce exactly one package");
  }
  const packagePath = join(workspace, basename(packResult[0].filename));
  npm(["init", "--yes"], { cwd: workspace, stdio: "ignore" });
  npm(
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", packagePath],
    { cwd: workspace, stdio: "ignore" },
  );
  const manifest = JSON.parse(
    readFileSync(join(workspace, "node_modules", "@amoeba", "upgrade-governance", "package.json"), "utf8"),
  ) as { name?: string; bin?: Record<string, string> };
  if (manifest.name !== "@amoeba/upgrade-governance") {
    throw new Error("installed package identity drifted");
  }
  if (manifest.bin?.["amoeba-upgrade-governance"] !== "./dist/upgradeGovernance/cliMain.js") {
    throw new Error("installed executable entrypoint drifted");
  }
  execFileSync(
    process.execPath,
    [
      join(workspace, "node_modules", "@amoeba", "upgrade-governance", "dist", "upgradeGovernance", "cliMain.js"),
      "--help",
    ],
    { cwd: workspace, stdio: "ignore" },
  );
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `const root = await import("@amoeba/upgrade-governance");
       if (root.release1CurrentInstructions.CREATE_CANDIDATE_COUNCIL_SET_V1_TAG !== 18 ||
           root.release1V3Instructions.INITIALIZE_CONTROLLER_V2_TAG !== 53 ||
           root.release1V3CustodyInstructions.ACTIVATE_ROLLBACK_V2_TAG !== 81 ||
           "release1LifecycleInstructions" in root ||
           "release1LoaderInstructions" in root ||
           root.artifactMerkleV1.RELEASE1_ARTIFACT_CHUNK_SIZE_V1 !== 16 * 1024 ||
           root.UPGRADE_GOVERNANCE_CLI_COMMANDS_V1.length !== 75 ||
           !root.UPGRADE_GOVERNANCE_CLI_COMMANDS_V1.includes("verify-local-ceremony") ||
           !root.OPERATOR_MUTATION_COMMANDS_V1.includes("execute-upgrade") ||
           !root.OPERATOR_MUTATION_COMMANDS_V1.includes("execute-emergency-resolution") ||
           !root.OPERATOR_MUTATION_COMMANDS_V1.includes("activate-rollback") ||
           root.GOVERNED_UPGRADE_RECEIPT_V3_VERSION !== 3 ||
           typeof root.verifyGovernedUpgradeReceiptV3 !== "function" ||
           root.GOVERNED_RELEASE1_CEREMONY_RECEIPT_V4_VERSION !== 4 ||
           typeof root.verifyGovernedRelease1CeremonyReceiptV4 !== "function") {
         throw new Error("installed package exports drifted");
       }`,
    ],
    { cwd: workspace, stdio: "ignore" },
  );
  process.stdout.write("installed package consumer check passed\n");
} finally {
  rmSync(resolvedWorkspace, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}
