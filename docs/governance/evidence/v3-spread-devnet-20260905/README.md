# Fresh Spread under V3 — Devnet

Finalized at slot 493855641. See [receipt.json](receipt.json) for source, artifact, authority and transaction identities.

Spread: `2jVQSPny9eFoaG1ZWoJVAezQ5VgqJtF8rQCQXMktuBVw`. Controller: `8fhNi6QHU5TYNhoPDM4vs89ZBztnpxp3LnBXRgkBVKtx`.

The existing KMS council controls both programs through a 3-of-5 quorum. New proposals receive 4,000,000 approval slots, about 7.7 days at the measured Devnet rate. The independent execution delay is 4,500 slots, and expiry is 7,000,000 slots from creation.

Spread's gate is EmergencyFrozen at epoch 1. It owns zero business accounts. No business bootstrap, state migration, activation or application integration was performed.

Focused checks: four Rust core checks, three actual-SBF rehearsals (self-upgrade, target adoption/extension/upgrade, and the fresh Spread frozen gate), two TypeScript checks, TypeScript compilation, byte-identical repeat builds and finalized chain verification. Repeat builds reused their caches; this does not claim independent clean reproducible builds or completion of the historical production release suite.

Controller artifact source: `4e9ae8b897f867fe0b4b689226feb34696772581`. Spread artifact source: `889f7228c6e770ccb2aae5340fd80604ee68738c`. Artifact diagnostics are recorded in [artifact-checks.json](artifact-checks.json).
