import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildRelease1GoldenFixture } from "../upgradeGovernance/release1SyntheticVector.js";

const v1FixturePath = fileURLToPath(
  new URL("../../../fixtures/upgrade_governance_v1.json", import.meta.url),
);
const targetPath = fileURLToPath(
  new URL("../../../fixtures/upgrade_governance_release1.json", import.meta.url),
);
const v1FixtureSha256 = createHash("sha256")
  .update(readFileSync(v1FixturePath))
  .digest("hex");
const output = buildRelease1GoldenFixture(v1FixtureSha256);
const canonicalWithZeroHash = `${JSON.stringify(output, null, 2)}\n`;
output.fixture_sha256 = createHash("sha256")
  .update(canonicalWithZeroHash, "utf8")
  .digest("hex");
const serialized = `${JSON.stringify(output, null, 2)}\n`;

if (process.argv.includes("--check")) {
  if (readFileSync(targetPath, "utf8") !== serialized) {
    throw new Error(
      "frozen Release 1 governance vector is stale; run npm run generate:release1-vectors",
    );
  }
} else {
  writeFileSync(targetPath, serialized, { encoding: "utf8" });
}
