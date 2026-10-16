# Candidate: verification metadata for the production oracle and futures

This is a source preparation, not a deployed release or a verified build recipe.
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

Before accepting these arguments for an actual controller upgrade, reproduce
the public source builds and compare the verifier's normalized executable hash
with each deployed program. Native build equality, published source and hosted
verification are separate evidence. If build qualification changes any argument,
update both Rust/TypeScript mappings and their tests before building a candidate.

The existing three-seat proposal and timing checks still authorize metadata;
the controller signs only its exact target-authority PDA through the fixed Otter
Verify CPI. No arbitrary URL, command, build flag or signer is introduced.

Focused tests cover both new recipe encodings, authority-derived accounts,
bounded transaction size, rejection of unrelated targets and preservation of
legacy recipe hashes. The existing ignored actual-controller/actual-verifier SBF
test now includes both new targets; it must run against the exact candidate ELF
before live qualification. No on-chain action is authorized by this document.
