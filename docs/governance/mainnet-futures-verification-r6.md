# Release 6: restore verification of the current Futures deployment

Status: release 6 installed at finalized slot **457963767**; updated hosted
verification passed on 2026-10-17. The subsequent inventory-netting Futures upgrade is
installed at slot **457976295**, Active at epoch **8**.
[Finalized installation, runtime and hosted-verification receipt](evidence/mainnet-inventory-netting-20261017.json)
records completed operations and matching canonical and authority-specific
hosted results for controller and Futures. Oracle remains verified.

The AMBA Earn deployment described below is the historical predecessor to the
installed inventory-netting release; its source/build evidence remains unchanged.

Futures `Bvp9kiRtJ7dT8unxP4Da39gv2eXDLEHLpcDfzcEuRKMu` was upgraded for
AMBA Earn at slot 457791760. The installed ELF is 444816 bytes, SHA-256
`b0480f9adc17c4d58a3f78bc84cb235c6b7ad92782ce6b00bbbf7c55fc666873`;
its normalized verification hash is
`bb068e2a37216b8ba0aced762a69d51424bd35253629dfac5c7379cf42c1a075`.
The matching public source is
[`8153c2d78938580eb3603c6690e4117908d84cdf`](https://github.com/amoeba-farm/amoeba-program/tree/8153c2d78938580eb3603c6690e4117908d84cdf).

The prior fixed compiler image uses `/opt/ameba-dev/worktrees/gate-final`.
This deployment used `/opt/ameba-dev/worktrees/amba-release`. The same source
under the previous image compiled successfully but did not match. An explicit
Rust path-remapping attempt also did not match. Reproduction under the original
working directory matches the deployed bytes exactly. The public image is:

```
us-central1-docker.pkg.dev/amoeba-hm0q2k/solana-verifiable-builds/amba-release@sha256:36bdcd0005a5a41f9eba76add58f16fccdc7a2b7b2fbace1be3aaba8cda7b40e
```

Release 6 changes only the fixed Futures image, authenticates the exact previous
Futures metadata during migration, and updates the controller/client release
binding. It does not add caller-selected recipes. Oracle, controller and Spread
recipes retain their existing bindings. Quorum, delay, accounts, authorities,
gates, Futures economics and the Futures binary are preserved.

## Candidate and checks

Code commit: `329d12ed91398e5bcbd379b382060a9411e75c2d`.

- Controller ELF: 239472 bytes, SHA-256
  `f714b680fc68cefef95eb3f8cd76622151478537a8887fe527e9b9bdd871b3d4`.
- Normalized hash:
  `534d7456bd65c0849345a130050882b45bd82b072d7dca0d71059b89ed8ce1f7`.
- Existing capacity: 247400 bytes; 7928 bytes remain. No extension is required.
- TypeScript typecheck/build, seven focused metadata/cap tests, frozen vectors,
  bridge/release-1 vectors and installed-package consumer passed.
- Rust recipe, policy and release-binding tests passed.
- Actual SBF integration against the pinned Mainnet verifier passed all four
  target recipes, malformed records, donations and CPI rollback checks.
- The old Futures record migrated from 488 to 490 bytes with a zero-SOL
  authority. The test verifies exact payer funding, exact output record and
  executed proposal; the test bank and Mainnet rent schedules differ.

The [canonical build receipt](evidence/controller-r6-build-20261017.json) and
[focused qualification](evidence/controller-r6-qualification-20261017.json)
bind the exact source and artifact. These tests do not represent a deployment.
The [second compilation](evidence/controller-r6-reproduction-20261017.json)
produced byte-for-byte identical output from a separate source/output directory.
It reused an isolated dependency cache after removing the controller's own
artifacts and fingerprints; it was not a clean build of every dependency.

## Prepared Mainnet operation

Controller: `8fhNi6QHU5TYNhoPDM4vs89ZBztnpxp3LnBXRgkBVKtx`, release 5 to 6.
The existing council requires three approvals and a 150-slot execution delay.
Windows KMS access is used without changing VM IAM. All chain requests use the
configured private Helius Mainnet endpoint.

The coordinator first simulates each available transaction, persists signed
bytes before submission, permits at most three Helius rebroadcasts of the same
bytes, and reconciles ambiguous signatures without automatic replacement.
The unsigned proposal-creation simulation passed against finalized Mainnet.

Finalized rent quote at 2026-10-17 03:16:50 UTC, slot 457883819:

| Item | SOL |
| --- | ---: |
| Temporary buffer, refundable after successful upgrade | 1.217355960 |
| Three proposal accounts | 0.008046720 |
| Futures metadata rent deficit | 0.000010160 |
| Retained rent after successful buffer refund | 0.008056880 |
| Storage extension | 0 |

Transaction fees are additional. Treasury held 4.583726481 SOL at this read;
execution seat 1 held 0.000700140 SOL. The record deficit accounts for its existing
lamports; it is not the full rent of a new metadata account.

The controller installation and exact-byte postflight completed. Inventory-netting
Futures was then installed and activated; API and bot runtime confirmation passed.
Controller and Futures metadata proposals are 75 and 76. Their finalized execution
receipts and matching hosted results are recorded in the linked completion receipt. Oracle is unchanged. The matching controller source was
propagated to the dev VM without dev-chain deployment or service changes.
