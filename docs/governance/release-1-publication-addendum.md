# Amoeba Governance Release 1 publication addendum

**Observation time:** 2026-08-29T05:02:55Z  
**Repository:** `SPACE999978/ameba_gov`  
**Published branch:** `main`

This addendum records the publication state after the local Release 1 reports
were written. It does not rewrite those historical reports and does not claim a
successful hosted verification run.

## Published identity

| Field | Value |
|---|---|
| Local `main` | `c2771a7a74c895bbb9a81ba38273e19ac25931ea` |
| `origin/main` after a fresh fetch | `c2771a7a74c895bbb9a81ba38273e19ac25931ea` |
| GitHub commit | `c2771a7a74c895bbb9a81ba38273e19ac25931ea` |
| GitHub-recorded push-trigger time | `2026-08-29T04:04:19Z` |
| Commit signature | unsigned; GitHub verification reason `unsigned` |
| Branch protection | disabled; the branch-protection API returned `404 Branch not protected` |

The push-trigger time is the `created_at` value of the exact GitHub Actions
`push` event for this commit. GitHub did not expose a separate repository push
event through the authenticated repository-events response.

## Hosted workflow result

| Field | Value |
|---|---|
| Workflow | `governance-trust-root` |
| Run ID | `33232928194` |
| URL | `https://github.com/SPACE999978/ameba_gov/actions/runs/33232928194` |
| Result | `failure` |
| Jobs | `sbpf-diagnostics` (`99048777360`), `native-and-parity` (`99048777471`) |
| Runner execution | none; both jobs report `runner_id = 0`, an empty runner name, and zero steps |

Both check-run annotations state exactly that the jobs were not started because
recent account payments failed or the spending limit must be increased. This is
an external account/billing rejection. It is neither a successful hosted run nor
a repository-code test failure.

The checked-in workflow SHA-256 is
`a2ba5b90d488b148e163a946fe11dc579586cba48421bf9c12168902bf718d90`.

## Local report and source reconciliation

The pushed tree is exactly the report commit named above. The attested
artifact/test source remains
`a0e74f5a3d9311e78c15890754ff9bdda666ed11`; the only changes from that source
commit to the pushed report commit are:

```text
docs/governance/phase-7-readiness-report.md
docs/governance/release-1-completion-report.md
```

Therefore the pushed controller source and build inputs still match the source
tree used by the existing local artifact report. This statement does not turn
those old artifacts into ceremony-closure artifacts; every final artifact must
be rebuilt and re-attested at the ceremony-closure ending commit.

## Protection recommendation

Before any future merge or release, require a pull request, the named governance
checks, at least one independent review, disabled force pushes and branch
deletion, and a signed release tag. No repository setting is changed by this
addendum.

No push, merge, tag, release, deployment, live RPC write, authority change,
immutability action, production identity selection, or service mutation is
performed by this ceremony-closure branch.
