# Candidate: verification metadata for the production oracle and futures

This candidate passed local build and integration qualification; it is not a deployed release or completed hosted verification.
The current release-4 controller supports authority-signed Otter metadata for
itself and the historical Spread target only. The candidate release-5 code adds
the production oracle `45YCerssGjg2M29RFc9D4fAJh7dfFpMJ3ZcZtaTnRXRS`
and futures `Bvp9kiRtJ7dT8unxP4Da39gv2eXDLEHLpcDfzcEuRKMu` to the same
closed recipe mapping. It changes no account layouts, instruction encoding,
quorum, timing, upgrade authority, business instructions or gate policy.

Both new targets use the existing official `amoeba-farm/amoeba-program`
repository, pinned verifier/image/architecture, and these candidate arguments:

| Target | Workspace path | Library |
| --- | --- | --- |
| Oracle | `oracle` | `ameba_oracle` |
| Futures | `futures` | `ameba_futures` |

The hosted verifier mounts the entire repository at the image work directory; the recipe does
not add the ignored legacy `--mount-path` argument for either new target.
The root mount preserves sibling Cargo path dependencies. Both use default
features, architecture `v1`, no environment overrides, and the existing pinned
Docker image with original source work directory `/opt/ameba-dev/worktrees/gate-final`:
`us-central1-docker.pkg.dev/amoeba-hm0q2k/solana-verifiable-builds/gate-final@sha256:7ad1e567f19831e658f5b892a7269d23d7f1826438e025b5d9d2e385240a4d67`.
The coordinator independently checked anonymous manifest/config access and the
image work directory. New oracle/futures metadata names verifier `0.5.2` and explicitly
passes `--cargo-build-sbf-args '--tools-version v1.53'`. The verifier supplies
`--locked` itself. Existing controller and
Spread recipe bytes remain unchanged. The old Spread recipe remains accepted
only for authenticating a previous Spread metadata record.

The coordinator reproduced both public Oracle and Futures builds using the pinned
original-path image and matched each installed executable exactly. Local build
equality and hosted verification remain separate evidence; hosted verification is
still pending.

The existing three-seat proposal and timing checks still authorize metadata;
the controller signs only its exact target-authority PDA through the fixed Otter
Verify CPI. No arbitrary URL, command, build flag or signer is introduced.

Focused tests cover both new recipe encodings, authority-derived accounts,
bounded transaction size, rejection of unrelated targets and preservation of
legacy recipe hashes. The existing ignored actual-controller/actual-verifier SBF
test passed all four target cases against the final canonical controller ELF from
source `1a8f9e3fa3c80e3d0d1a20651742a0b5e17640fe` and the actual mainnet verifier
ELF. The controller artifact is 238936 bytes, SHA-256
`ea8dd309053dd52c768d8d04e5e0dc73b48bae4a3f289b67638ed328bd767bee`.
See the [qualification receipt](../evidence/controller-verification-candidate-20261016.json)
for exact inputs, results and limits. No on-chain action is authorized by this document.
