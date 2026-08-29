import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  finalizeGovernedRelease1CeremonyReceiptV4,
  verifyGovernedRelease1CeremonyReceiptV4,
  type GovernedRelease1CeremonyReceiptV4Material,
} from "../upgradeGovernance/receiptV4.js";

const [materialArgument, receiptArgument, verificationArgument] = process.argv.slice(2);
if (materialArgument === undefined || receiptArgument === undefined || verificationArgument === undefined) {
  throw new Error(
    "usage: finalize-local-ceremony-receipt <material.json> <receipt.json> <verification.json>",
  );
}

const materialPath = resolve(materialArgument);
const receiptPath = resolve(receiptArgument);
const verificationPath = resolve(verificationArgument);
const material = JSON.parse(
  readFileSync(materialPath, "utf8"),
) as GovernedRelease1CeremonyReceiptV4Material;
const receipt = finalizeGovernedRelease1CeremonyReceiptV4(material);
const verification = verifyGovernedRelease1CeremonyReceiptV4(receipt);

writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
writeFileSync(verificationPath, `${JSON.stringify(verification, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`${JSON.stringify(verification)}\n`);
